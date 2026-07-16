# SDKMessage 觀察筆記

> ✅ **狀態:spike 已實跑並校正(2026-07-13)。** 憑證來源:**登入中的 Claude Code CLI**(Agent SDK 沿用其 OAuth,
> 不需另設 `ANTHROPIC_API_KEY`)。以下為 `npm run spike` 的實際觀察 + SDK 型別定義
> (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)交叉確認的結論。

## 5 個觀察點(實測結果)

1. **訊息型別 (`type`)**:實見 `'system'` | `'assistant'` | `'user'` | `'result'`。
   - `system` 有多種 `subtype`:`hook_started` / `hook_response`(SessionStart hook)、`init`(最前,含 tools 清單、`permissionMode`、mcp_servers)、
     `task_started`(含 `subagent_type`、`task_description`、`tool_use_id`)、`task_progress`(含 `description` 如 "Reading src\types.ts"、`last_tool_name`)、`task_completed`。
   - `result` 出現在最後,含 `permission_denials: []`、usage 等。
   - Translator 目前只吃 `assistant` / `user`,樹/日誌即可成形;`task_progress` 是很好的即時日誌來源,**列為擴充點(YAGNI)**。

2. **父子關係 (`parent_tool_use_id`)**:✅ 確認為 **top-level 欄位**。
   - 主 agent 訊息:`parent_tool_use_id === null`。
   - subagent 內部訊息:`parent_tool_use_id === <派它的 subagent tool_use 的 id>`(實測 29 則掛在同一 id 下)。
   - → 建構樹狀父子關係的依據,`msg?.parent_tool_use_id ?? null` 正確。

3. **工具呼叫 (`tool_use`)**:✅ `assistant.message.content[]` 內 `{ type:'tool_use', id, name, input }`(另有 `caller`)。

4. **工具結果 (`tool_result`)**:✅ `user.message.content[]` 內 `{ type:'tool_result', tool_use_id, content, is_error }`。

5. **subagent / skill 呈現**:⚠️ **重大校正** —— 實際的 subagent 工具名是 **`Agent`**(不是假設的 `Task`),
   `input` 為 `{ description, prompt, subagent_type, run_in_background }`。
   - Translator 已修:`Agent` 與 `Task` 皆 → `subagent`,label 用 `input.description`。
   - ✅ **Skill 已於瀏覽器 E2E 實測**:name=`Skill` → `skill` 正確;input 欄位是 `skill`(如 `superpowers:brainstorming`),
     Translator 的 `labelFor` 已改用 `input.skill`。

## canUseTool(核准閘)關鍵發現

- **此回合 canUseTool 一次都沒被呼叫**,即使跑了 Grep / Read / Agent。原因:`permissionMode: "default"` 下
  **唯讀 / agent 類工具自動放行**,只有需要權限的工具(Bash / Write / Edit)才會走 canUseTool。
  → **UI 的核准框只會為「需要權限的工具」出現,不是每個工具都跳。** demo 核准請叫 agent 去寫檔 / 跑 bash。
- 簽名(SDK 型別確認):`(toolName, input, options)`,其中
  - `options.toolUseID`(**大寫 ID**)= tool_use block 的 `toolu_...` id → 核准框可精確對到樹節點。
  - `options.signal`(SDK 給的 AbortSignal)、`suggestions`、`title`、`displayName` 等。
  - 回傳 `PermissionResult | null`:`{behavior:'allow', updatedInput?}` 或 `{behavior:'deny', message, interrupt?}`。
- `agentAdapter.ts` 已校正:讀 `opts.toolUseID`(先前錯讀 `toolUseId`/`tool_use_id`)。

## 中止行為

- SDK 提供兩種:`Options.abortController`(傳入,`.abort()` 中止)與 `Query.interrupt()`。
- `agentAdapter.ts` 採 `Options.abortController`,並把 SessionManager 的外部 `signal` 橋接進去
  (`signal.addEventListener('abort', () => abortController.abort())`)。
- abort 後 `for await` 的實際結束方式(丟錯 vs 收 result)本回合未觸發,**留待真實暫停 E2E 驗證**。

## E2E 驗證結果(2026-07-14)

- [x] **canUseTool 對 Write 實際觸發,核准框閉環** —— headless(`spike/e2e.ts`)+ 真實瀏覽器(Playwright)兩層都通:
      前端按「核准」→ POST `/control` → SessionManager resolve pending → agent 續跑 → 檔案寫出 → 節點轉 `done`。
      `await:tool` 的 toolUseId 與 `tree:node` id 完全相同(`toolu_...`),證明 `toolUseID` 對接正確、前端節點狀態連動成立。
- [x] **Skill 工具的 tool name 與 input**:name=`Skill`、input.skill(見上)。
- [x] **`pause()` → abort 行為**(`spike/pause-e2e.ts` 實測,2026-07-14):
  - **同一回合內暫停**:in-flight 工具被中斷 → 回 `is_error` 的 tool_result(節點轉 `error`)→ agent 停手 →
    stream **乾淨結束、`for await` 不丟錯、不發 `session_error`**。後端 log 無 `consume error:`。
  - ✅ **已修(選項 B):pause 後可開新 session。** 先前 `pause()` abort 了 `this.controller` 卻沒重建,
    導致下一次 `/start` 拿到已 abort 的 signal → 立刻 `Operation aborted` → `session_error`(session 等於已死)。
    修法在 `pause()` 內:abort 後**重建 `AbortController`**,並**清空輸入佇列**(`inbox` / `inboxResolvers`)——
    後者是隱藏 bug:舊 session 遺留在 `inboxResolvers` 的孤兒 resolver 會被下一次 `pushInput` 的 `shift()` 取走、
    把新訊息餵給已死的 iterator,使新 query 收不到 prompt。
  - **驗證**:`spike/pause-resume-e2e.ts` 實測 —— task1 → pause → task2(Write)→ `canUseTool Write` 觸發、核准後
    寫檔成功、**零 `session_error`**。單元:`tests/sessionManager.test.ts`「pause 後重建 AbortController」。
  - **語意注意**:這是「可開**新** session」,不是「續原對話」——abort 後 SDK 對話已丟。派任務(followup)若要延續
    同一對話,不應先 pause。ControlBar 在 pause 後仍 enabled,語意上比較接近「開新任務」。
  - **附帶觀察**:nested agent(Agent SDK 內的 claude 子程序)寫相對路徑檔時,cwd 落在專案名的連字號變體目錄
    (`claude-code-superpower-visualizer`),非 server 的 cwd。與 pause 無關,但寫檔任務給絕對路徑較保險。

## cwd / workspace(2026-07-14 診斷 + 強化)

- **診斷結論:並非 cwd 解析 bug。** 實測 agent 的 Bash `pwd` = 正確的底線專案路徑;給「相對路徑」的 Write,
  SDK 收到的 `file_path` 也是正確的底線絕對路徑、檔案落在專案根。先前跑到連字號目錄,是那幾個 prompt 講
  「在專案根目錄建立…」時 **agent 自行幻想了一個絕對路徑**(用錯的專案名),屬一次性幻覺,非系統性問題。
  核准框會顯示完整 `file_path`,真人操作看得到就能拒絕(自動核准的 E2E 才沒擋)。
- **強化(已做):** `agentAdapter.buildOptions` 明確把 SDK `options.cwd` pin 到 `resolveWorkspace()`
  (`process.env.AGENT_WORKSPACE?.trim() || process.cwd()`),不再隱式依賴啟動當下的 cwd,並可指向任一目標專案。
  - 驗證:`AGENT_WORKSPACE=<專案>/web npm run dev` 後,agent 的 `pwd` = `.../superpower_visualizer/web`(生效)。
  - 單元:`tests/agentAdapter.test.ts`(resolveWorkspace 三情境 + buildOptions 的 cwd/abortController/toolUseID)。

## Route A 旁觀 tailer(2026-07-15,最小 PoC)

> 目標:唯讀地把「其他/正在跑的」Claude Code CLI session 即時串進現有 UI(前端完全不動)。

- **資料來源**:`~/.claude/projects/<slug>/<session>.jsonl`(主檔)+ `<session>/subagents/agent-<agentId>.jsonl`(子檔)。
- **schema 差異(對比 SDK 串流)**:parentId 不在記錄裡;人類訊息是頂層 `message.content` **字串**;
  subagent 連結靠主檔 Agent 的 `toolUseResult.agentId` → 對到子檔,子檔內工具掛在該 `Agent` tool_use 節點下。
- **新增檔(下游全部沿用 `SnapshotStore` + WS + 前端)**:
  - `src/translateTranscript.ts`:一筆記錄 → `FrontendEvent[]`,parentId 由呼叫端傳入。重用 translator 的 `toolTypeOf` / `labelFor`。
  - `src/transcriptSource.ts`:`TranscriptSource`(backfill + 400ms 輪詢新增行,只吃完整的行;
    發現 `agentId` 連結就把子檔加入追蹤、掛在對應節點下,同一 tick 內反覆掃到收斂)+ `pickLatestSession()`。
  - `src/tailServer.ts`:觀察模式伺服器,port 3001,`/start` `/control` 唯讀 no-op(回 `readOnly:true`),
    workspace 取逐字稿的 `cwd`。啟動:`TAIL_SESSION=<path.jsonl> npm run tail`(不給就挑最近修改的 session)。
- **實測**:
  - 富 session(AI-mantor `bdd3006d`)backfill:**2243 工具節點 · 134 subagent 全部連到子檔 · skill 18 · MCP 6 · 對話 1689**。
  - 瀏覽器 E2E(HW-chess `770e9679`):現有 UI 直接顯示 **359 節點 · 22 subagent**、subagent 區塊可展開工作項目、
    右側對話重建、標題列顯示該 session 的 workspace,唯一 console error 是 favicon 404(無害)。
- **限制**:唯讀——逐字稿是歷史紀錄,沒有 pending 核准,故觀察模式不會有核准 modal;pause/followup 不作用。
- **測試**:`tests/translateTranscript.test.ts`(6)、`tests/transcriptSource.test.ts`(backfill + subagent 連結 + 輪詢追加,3)。
- **驗證腳本**:`spike/tail-probe.ts <session.jsonl>`(印出 backfill 產出的事件統計)。

## 雙模式整合:Route A/B 可切換 + session 選單(2026-07-15)

> 把 Route A(觀察)與 Route B(操控)併進**同一個** :3001 伺服器,前端用標題列「來源」下拉切換。
> `tailServer.ts` 已移除(被 `/observe` 取代)。

- **`SourceController`(`src/sourceController.ts`)** 管理「目前來源 + 模式」,兩種來源共用同一個 `store` + `broadcast`:
  - `observe(file)`:`onEnterObserve()`(叫停 control agent)→ `source.stop()` → `store.reset()` → 建 `TranscriptSource`。
    **backfill 期間靜默灌 store(不逐筆廣播),跑完只送一份 snapshot**,避免幾千筆 event 洗版;之後 live tail 才逐筆廣播。
  - `toControl()`:停 source、reset、回 control、廣播空 snapshot。
  - `snapshot()` 封包多帶 `mode: 'control' | 'observe'` 與 `workspace`。
- **`SnapshotStore.reset()`**:清 nodes/logs/messages、`seq` 歸零。前端 `applyPacket` 的 snapshot 分支**無 seq 守門**,
  所以 reset(seq→0)+ 新 snapshot 能乾淨 rebase 每個 client(舊 client 即使 seq=500 也會被整包覆蓋)。
- **端點**:`GET /sessions`(列 `~/.claude/projects`,`src/sessions.ts`,只讀檔頭 64KB 取 cwd + 數子檔,不解析整份)、
  `POST /observe {file}`、`POST /new-agent`(回 control 空白);`POST /control` 在 observe 模式一律 no-op(`readOnly:true`);
  `POST /start` 若正在 observe 會先 `toControl()` 再啟動。
- **前端**:`SourcePicker` 下拉(新 Agent + 各 session,附相對時間 / subagent 數);`state.mode` 帶進 store;
  observe 模式輸入框停用、隱藏暫停鈕、送出停用、不跳核准 modal。vite proxy 補上 `/observe /new-agent /sessions`。
- **實測**:瀏覽器切到 HW/chess → 標題轉「觀察中(唯讀)」、Agents 從 0 變 **359 節點 · 22 subagent**、
  workspace 顯示 `C:\Users\wesle\Desktop\HW\chess`、暫停鈕消失;`/new-agent` → 回 control、nodes 歸 0、workspace 復原。
- **踩雷**:`readWorkspace` / `firstCwd` 原本讀「第一行」就 break,但逐字稿第一筆常是沒有 cwd 的 summary → 抓不到 cwd。
  改成掃檔頭多行(bounded 64KB),並把兩者統一到 `sessions.firstCwd`(`readWorkspace = firstCwd(file) || file`)。
- **測試**:`tests/snapshot.test.ts`(+reset)、`tests/sessions.test.ts`(3)、`tests/sourceController.test.ts`(4)、
  `web/tests/App.test.tsx`(+observe 唯讀、+下拉切換 observe/new-agent)。後端 39 / 前端 30 全綠、`tsc` 乾淨。

## ReAct 顯示:每個工具補上「理由」(2026-07-16)

> 需求:左側只看得到「動作」(工具),看不出 agent 用工具的理由(ReAct 的 Reason)。左側也太扁平。

- **reason 從哪來**:逐字稿/串流裡 agent 動手前那句 `text` 敘述(「先看結構,因為…」)就是理由。原本被當對話訊息
  丟到右欄、跟工具脫鉤。改成配對到工具。**extended thinking 不用**:掃 3 份逐字稿共 464 個 thinking block
  內容全為空字串(只留 signature,存檔時被清掉),觀察模式拿不到。
- **`ReActAssembler`(`src/reactAssembler.ts`,Route A/B 共用、有狀態)**:
  - `translate` / `translateTranscript` 的 assistant text 改發中介事件 `assistant-text {parentId, text}`(不再直接發 message)。
  - 每個 agent(parentId)一個待定敘述緩衝;敘述累積 → 遇工具 → 掛成該工具 `reason`(一句理由對整批:只掛該批**第一個**
    工具,同批後續無 reason,前端把 reason 當群組標題顯示一次)→ 清空;遇人類訊息 / session 結束 / `flushAll` →
    把還沒配到工具的敘述 flush 成 assistant 對話訊息(那是總結)。
  - 接線:`wireEvents` 收 `result` → `flushAll`;`emitUserMessage` 走 assembler;`SourceController` backfill 後 `flushAll`,
    切換來源時 `assembler.reset()`。`TreeNode` 加 `reason?`。
  - 另外:tool_use 不再補「label log」,`log` 只留 tool_result 的實際輸出 → 結果摘要/展開輸出是純結果(不會拿工具名當輸出)。
- **前端**:`AgentBlocks` 每個工具渲染成步驟:💡 reason(該批標題,會換行)→ 工具動作 → 結果摘要(輸出第一行,ellipsis)→
  展開輸出;subagent 區塊上方顯示「派它的理由」。實測某 session:359 工具中 67% 有 reason。
- **踩雷(版面全空白)**:過長的 reason 文字 + `nowrap` 的結果摘要,在缺 `min-width:0` 的 flex/grid 鏈上會把
  `.agent-block` 撐到 ~4800px,被其 `overflow:hidden` 裁掉 → 左欄整片空白。修法:`.agent-block` 改 flex column,
  並在整條鏈(`.ab-body / .work / .wstep / .witem-row / .wreason …`)補 `min-width:0`,reason 用 `overflow-wrap:anywhere`。
- **測試**:`tests/reactAssembler.test.ts`(8)、`web/tests/AgentBlocks.test.tsx`(+reason/結果摘要、+subagent reason);
  translator/transcript/server 測試同步改為 `assistant-text`。後端 48 / 前端 32 全綠、`tsc` 乾淨。
