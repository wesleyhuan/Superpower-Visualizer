# Superpower Visualizer — 設計文件

- 日期:2026-07-13
- 狀態:設計定案,待實作計畫

## 目標

做一個**本地 Web App**,讓一般使用者透過視覺化介面**即時監控並控制**一個 Claude agent 的開發過程:看到它呼叫了哪些 skill、派了哪些 subagent、彼此如何互動、正在做什麼,並能在過程中**暫停、核准權限、派新任務**。

## 需求摘要

| 面向 | 決定 |
|------|------|
| 使用情境 | 即時監控(Live) |
| 互動程度 | 可控制介入(暫停 / 核准權限 / 派新任務) |
| 架構路線 | 路線 B — UI 用 Agent SDK 自己當指揮官啟動並驅動 agent |
| 技術堆疊 | 本地 Web App:Node 後端 + React 前端 + **Claude Agent SDK**(`@anthropic-ai/claude-agent-sdk`) |
| 核心畫面 | ① Agent/Skill 互動樹狀圖 ② 即時活動日誌流 |
| 範圍(v1) | **單一 session**;任務看板、成本/token 統計為 YAGNI,留擴充點 |

> **重要前提**:本專案建構在 **Claude Agent SDK**(`@anthropic-ai/claude-agent-sdk`,即「Claude Code 打包成函式庫」),它內建 Read/Write/Edit/Bash/Grep 等工具、subagent、權限機制與 hooks。它與 Claude API / Managed Agents 是不同的產品。權威文件:`code.claude.com/docs/en/agent-sdk`——實作時所有 SDK 函式簽名以該文件為準。

## 1. 整體架構

```
瀏覽器 (React 前端)
  互動樹狀圖 / 活動日誌流 / 控制列(暫停·核准·派任務)
        ▲ WebSocket(事件下行)      │ HTTP(指令上行)
        │                          ▼
Node 後端(指揮官)
  Session Manager  — 用 query() 啟動 agent,持有 AbortController;
                     canUseTool 卡住等前端核准;streaming input 注入追加訊息
        │ 消費 SDKMessage 串流
  Event Translator — 把 SDKMessage 轉成 ①樹節點 ②日誌事件(無狀態純函式)
        │ query({ prompt, options })
        ▼
  @anthropic-ai/claude-agent-sdk(內建工具 + subagent + 權限 + hooks)
```

資料流方向性:

- **下行(agent → 前端)**:SDK 吐出 `SDKMessage` 串流 → 後端翻譯成「樹更新」與「日誌事件」→ WebSocket 推播。單向、高頻。
- **上行(前端 → agent)**:使用者按控制鈕 → HTTP 打到後端 → 觸發 `canUseTool` 的 resolve、`AbortController.abort()`、或往 streaming input 塞新訊息。低頻、指令式。

三個單元各司其職:`Session Manager`(agent 生命週期與控制,有狀態)、`Event Translator`(純資料轉換,無狀態、好測)、`React 前端`(純顯示 + 發指令)。三者以明確介面溝通,可各自獨立測試。

## 2. 元件與介面

### ① Session Manager(後端,有狀態)

```ts
class SessionManager {
  start(initialPrompt: string): void          // streaming input 模式啟動
  pause(): void                                // → AbortController.abort()
  approveTool(toolUseId: string, allow: boolean): void  // → resolve 卡住的 canUseTool
  sendFollowup(text: string): void             // → 往 input generator 推新訊息
  onMessage(cb: (m: SDKMessage) => void): void // 事件出口
}
```

三個控制動作對應 SDK 三個機制:

- **暫停** → 持有 `AbortController`,`abort()` 中止當前 `query()`。
- **核准權限** → `options.canUseTool` 回呼回傳一個 pending `Promise`,記下 `toolUseId`;前端核准時才 resolve(`{behavior:'allow'}` / `'deny'`)。天生的 human-in-the-loop 閘門。
- **派任務** → streaming input(prompt 傳 async generator);`sendFollowup` 往 generator 塞一則新的 user message。

### ② Event Translator(後端,無狀態純函式)

```ts
function translate(msg: SDKMessage): FrontendEvent[]

type FrontendEvent =
  | { kind: 'tree:node';   node: TreeNode }
  | { kind: 'tree:status'; id: string; status: NodeStatus }
  | { kind: 'log';         entry: LogEntry }
  | { kind: 'await:tool';  toolUseId: string; name: string; input: unknown }

type TreeNode = {
  id: string
  parentId: string | null   // subagent/skill 的父子關係
  type: 'agent' | 'subagent' | 'skill' | 'tool'
  label: string             // 例:"Bash: npm test" / "skill: brainstorming"
  status: NodeStatus
}
type NodeStatus = 'running' | 'awaiting' | 'done' | 'error' | 'interrupted' | 'failed'
```

映射規則(SDKMessage → 事件):

- assistant message 的 `tool_use` block → `tree:node`(type=tool)+ `log`
- 工具是 `Task`(派 subagent)→ node type=subagent,後續該 subagent 的訊息掛在其下
- 工具是 skill 呼叫 → node type=skill
- user message(tool_result)→ 對應節點 `tree:status`=done/error + `log`
- `canUseTool` 觸發 → `await:tool`,節點 status=awaiting

> **父子關係建構**:依賴 SDK 訊息攜帶的 session / parent 識別(subagent 有自己的來源標記)。**這是實作時第一個要對著 agent-sdk 文件驗證的關鍵細節。**

### ③ React 前端(純顯示 + 發指令)

- **樹狀圖**:消費 `tree:*` 事件維護樹,呈現 agent→subagent→tool 層級。
- **日誌流**:消費 `log` 事件,append-only 時間軸,可依節點過濾。
- **控制列**:出現 `await:tool` 時彈核准框;暫停鈕、追加訊息輸入框。

### 傳輸介面

- **下行 WebSocket**:server 推 `FrontendEvent`(JSON),每則帶單調遞增 `seq`。
- **上行 HTTP**:`POST /control/pause`、`POST /control/approve {toolUseId, allow}`、`POST /control/followup {text}`。

## 3. 資料流時序

### 情境 A:需核准的工具呼叫(核心閉環)

1. agent 決定呼叫工具 → `canUseTool` 觸發,SDK 卡住等 Promise。
2. Session Mgr 記下 `toolUseId`,建立 pending Promise;Translator 產生 `await:tool`。
3. 前端彈核准框,節點轉 awaiting(黃)。
4. 使用者核准 → `POST /control/approve` → resolve 對應的 pending Promise(`{behavior:'allow'}`)。
5. SDK 真的執行工具,`tool_result` 回來。
6. Translator 產生 `tree:status=done` + `log`。
7. 前端節點轉綠,日誌加一條。

**agent 是真的被卡住的**——工具在使用者決定前不會執行。這是「可控制介入」的技術根基:事前閘門,而非事後補救。

### 情境 B:派 subagent + 樹狀掛載

主 agent 呼叫 `Task` → Translator 產生 `tree:node { type:'subagent', parentId:<主agent id> }` → 該 subagent 後續工具呼叫的 `parentId` 都指向此節點 → 前端樹長出第二層。

### 情境 C:暫停 / 派新任務

- **暫停**:`POST /control/pause` → `abort()` → SDK 中止 → 所有 running 節點標 `interrupted`。
- **派新任務**:`POST /control/followup {text}` → 往 input generator 推新 user message → agent 當前回合結束後接續 → 新節點繼續 append。

### 關鍵不變式

1. 每個 `tool_use` 一定配對一個結束事件(done/error/interrupted),節點不會永遠 running。
2. `await:tool` 一定有對應 approve;使用者不決定則節點停在 awaiting、agent 停著(預期行為)。
3. 事件順序即因果順序,WebSocket 保序推送。

## 4. 控制流併發與邊界

1. **多工具同時等核准**:Session Mgr 維護 `Map<toolUseId, pendingResolver>`,各自 pending、各自 resolve;前端核准框做成佇列。resolve 一律用 `toolUseId` 精準對應。
2. **暫停時有 pending 核准**:順序為 ①deny 所有 pending resolver → ②清空 Map → ③`abort()`,避免 Promise 懸置洩漏。
3. **派任務時 agent 正在跑**:streaming input push 是排隊的,新訊息在當前回合結束後才讀,不打斷正在執行的工具;UI 標「已排隊」。「立刻停下改做別的」= 暫停 + 派任務兩步,UI 分兩鈕。
4. **核准框開著但 session 已終止**:前端主動失效所有核准框;送達的 approve 對應不到 pending 就靜默丟棄(冪等)。
5. **重複指令**:所有控制端點冪等——approve 查不到 Map 就 no-op,pause 對已中止 session 是 no-op。
6. **單一 session 假設**:v1 只跑一個 session,所有狀態屬於它。多 session 是方向 2:把這包狀態包成 `Session` 物件、外加 `Map<sessionId, Session>` 即可擴充,現在不預先設計。

### 狀態機(單一 session)

```
idle ─start→ running ─┬─ (canUseTool) → awaiting ─approve→ running
                      ├─ (followup 排隊) ───────────────→ running
                      ├─ pause → interrupted → (終止)
                      └─ 自然結束 / error → done / failed
```

## 5. 錯誤處理與韌性

核心原則:**後端是唯一真相來源,前端隨時可從後端重建畫面。**

1. **WebSocket 斷線重連**:後端保留當前 session 完整狀態快照(整棵樹 + 日誌緩衝)。前端重連 → 先收 `snapshot`(完整樹 + 最近 N 條日誌)→ 再接增量事件。每事件帶單調遞增 `seq`,前端丟棄 `seq` ≤ 已見的重複事件。
2. **Agent SDK 崩潰 / 非預期終止**:Session Mgr 用 try/catch 包住消費迴圈,**印出實際 error 不吞掉**,轉成 `session:error` 事件推前端;所有 running/awaiting 節點標 `failed`;先 deny 所有 pending resolver 再收尾。
3. **工具本身執行失敗**:`tool_result` 帶 `is_error` 是正常 agent 流程 → `tree:status=error`(紅)+ 帶錯誤內容的 log;agent 通常自行改用別法,樹接著長。
4. **核准逾時(可選)**:每個 pending 核准可設逾時,逾時自動 deny + log。v1 預設不逾時(嚴格 human-in-the-loop),逾時當設定項留擴充。
5. **後端重啟**:v1 session in-memory 不持久化;後端重啟 = 當前工作中止,前端顯示「連線中斷,session 已結束」。持久化 / 斷點續跑是 v2;架構上 Translator 無狀態、快照集中於 Session Mgr,未來加持久層只需序列化那包快照。

### Debug log 策略

在容易出錯處主動加 log(Node 慣用 logging):

- 外部輸入 / SDK 回應:每則 `SDKMessage` 進 Translator 前 log 其 type(debug)。
- 控制指令:每個 approve/pause/followup 進來時 log `toolUseId`、動作、當前 pendingMap 大小。
- 邊界與 null:`canUseTool` 觸發、pending resolve/deny、WebSocket 斷線重連、`seq` 落差各一條 log。
- try/catch:Session Mgr 消費迴圈的 catch **印出實際 error 物件**,絕不靜默吞掉。

## 待實作驗證清單(對照 agent-sdk 文件)

1. `SDKMessage` 如何攜帶 subagent 的 parent / session 識別,以建構樹狀父子關係(第 2 段標記的關鍵點)。
2. `options.canUseTool` 回呼的精確簽名與回傳型別(`{behavior:'allow'|'deny'}` 的實際結構)。
3. streaming input(async generator prompt)的用法,以及 push 新訊息的機制。
4. `AbortController` 與 `query()` 的中止行為,以及中止後 SDK 會吐出什麼終止訊息。
5. skill 呼叫在 `SDKMessage` 中的呈現方式(如何辨識「這是一次 skill 使用」)。
