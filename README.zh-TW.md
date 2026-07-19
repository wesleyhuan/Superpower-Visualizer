# Superpower Visualizer

[English](README.md) | **繁體中文**

即時**監控並介入** Claude agent 開發過程的本地 Web App。UI 本身就是指揮官——透過
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) 啟動並驅動 agent,把它的
工具呼叫、subagent、skill 即時畫成一棵互動樹 + 一條活動日誌流,並讓你在它動手前**核准 / 拒絕**
需要權限的工具、隨時**暫停**、或**派新任務**。

**兩種模式(同一個伺服器、同一套 UI,標題列「來源」下拉切換):**

- **操控(Route B)** — UI 自己用 Agent SDK 啟動 agent,可核准 / 暫停 / 派任務。
- **觀察(Route A,唯讀)** — 旁觀**其他 coding agent 的 session**,即時重建成同一套互動樹 + 對話。
  支援兩種系統(來源下拉先選系統):
  - **Claude Code** — 讀 `~/.claude/projects/<slug>/<session>.jsonl`(主檔 + `subagents/`)。
  - **Antigravity**(Google)— 讀 `~/.gemini/antigravity/conversations/<id>.db`(SQLite,steps 為 protobuf);
    每個工具自帶 `toolAction`,直接當 ReAct 的「想法」。v1 為扁平(一個對話 = 一個 agent 區塊)。
  因為是歷史紀錄,觀察模式不會有核准框,也不能暫停 / 派任務(輸入框顯示「觀察中(唯讀)」)。

```
┌─────────── 瀏覽器 (:5173) ───────────┐         ┌──────── 後端 (:3001) ────────┐
│  互動樹  │  活動日誌  │ 核准佇列 │控制列│         │  Express + WebSocketServer   │
└───────────────┬──────────────────────┘         │  SessionManager ── canUseTool │
                │  WS 事件流 (下行, 帶 seq)         │        │                      │
                │◀─────────────────────────────────┤   translate() → SnapshotStore │
                │  HTTP /start /control (上行)      │        │                      │
                └─────────────────────────────────▶│   Agent SDK query()  ─────────┼──▶ 真實 agent
                                                    └──────────────────────────────┘
```

- **下行**:事件經 `translate()`(Route B 串流)或 `translateTranscript()`(Route A 逐字稿)轉成前端事件、
  進 `SnapshotStore`(帶單調遞增 `seq`),用 WebSocket 廣播。重連時先送 snapshot,再送增量事件;前端用 `seq` 去重。
- **上行**:核准 / 暫停 / 派任務 POST `/control`,啟動 POST `/start`;切換來源 POST `/observe`、`/new-agent`;
  列 session `GET /sessions`。
- **後端是唯一真相來源**。一次觀察 / 操控**一個** session,由 `SourceController` 管理切換。

## 需求

- Node.js 18+(實測 v24)
- **已登入的 Claude Code CLI** —— Agent SDK 會沿用它的憑證,**不需要另設 `ANTHROPIC_API_KEY`**。
  確認方式:`claude --version` 有輸出即代表已安裝並登入。

## 安裝

```bash
# 後端(專案根目錄)
npm install

# 前端
cd web && npm install && cd ..
```

## 啟動

開**兩個終端**,分別跑後端與前端(兩者都要開著):

```bash
# 終端 1 — 後端(:3001)。在專案根目錄
npm run dev

# 終端 2 — 前端(:5173)
cd web && npm run dev
```

瀏覽器開 <http://localhost:5173>,標題列右上出現 🟢「已連線」即代表接上後端。

**停止:** 在各自的終端按 `Ctrl+C`。若 port 被占住(EADDRINUSE :3001),先找出並砍掉殘留行程:

```bash
# 找出占用 3001 的 PID 再砍(5173 同理)
netstat -ano | grep ":3001" | grep LISTENING
powershell -Command "Stop-Process -Id <PID> -Force"
```

## 使用方式

標題列右上的「**來源**」下拉決定目前是哪一種模式:

### A. 操控模式(Route B)— 自己啟動並指揮 agent

1. 確認來源下拉顯示「**操控模式**」(預設;若在觀察中,點下拉選「＋ 新 Agent(操控)」切回)。
2. 在最下方輸入框打一段任務,例:`請用 Grep 找出所有 .ts 檔並用一個 subagent 總結`,按「送出」啟動。
3. 左側「Agents」即時長出節點(狀態:⏳ 執行中 · 🟡 等待核准 · ✅ 完成 · ❌ / 💥 錯誤);右側「對話」顯示 agent 的回覆。
4. agent 要用**需權限的工具**(Bash / Write / Edit 等)時會**跳出核准視窗**——按「核准」放行、「拒絕」擋下。
   (唯讀工具如 Read / Grep 在 default 權限模式自動放行,不跳核准。)
5. 「暫停」中止目前執行;啟動後在輸入框再打字送出 = **派新任務**(排進 agent 輸入佇列)。

**指定 agent 的工作目錄:** 預設在 `process.cwd()`(啟動 `npm run dev` 的目錄)操作。要它在**別的**專案動手,
用 `AGENT_WORKSPACE` 指過去(Read / Write / Bash 的相對路徑都以它為基準),標題列會顯示目前工作目錄:

```bash
AGENT_WORKSPACE="D:/path/to/target-project" npm run dev
```

### B. 觀察模式(Route A)— 唯讀旁觀其他 coding agent

1. 點「來源」下拉 → **先選系統**:「觀察 Claude session」或「觀察 Antigravity 對話」。
2. 該系統的 session 會列出來(依最後修改時間排序):
   - Claude:顯示專案 slug + subagent 數(來源 `~/.claude/projects`)。
   - Antigravity:顯示角色身分(orchestrator / explorer …)+ 步數(來源 `~/.gemini/antigravity/conversations`)。
3. 選一個 → 立即重建成互動樹 + 對話;若那個 session **正在跑**,新追加的內容會即時流進畫面
   (Claude 輪詢逐字稿新行;Antigravity 以 `steps.idx` 當游標輪詢新步驟)。
4. 觀察模式是**唯讀**的:標題轉「觀察中(唯讀)」、輸入框停用、沒有核准框 / 暫停(逐字稿是歷史紀錄)。
5. 要看**你自己當下這個 Claude session**,選 Claude 清單最上面、時間顯示「剛剛」的那筆即可。
6. 選「＋ 新 Agent(操控)」回到操控模式(畫面清空、可重新下任務)。

> **Antigravity 的 reason**:每個工具步驟自帶 `toolAction`(為什麼)與 `toolSummary`(做什麼),
> 分別進「💡 想法」與「🔧 動作」。Antigravity 常把思考與動作放同一步,所以工具不會漏。
> 逐字稿是 protobuf,v1 用泛型萃取(不需 `.proto`),模型的長篇 thinking 暫不顯示(避免混入檔案內容)。

> 切換來源時後端會 `store.reset()` 並重送一份完整 snapshot,前端整包覆蓋,不會殘留上一個 session 的節點。

### 讀左側「Agents」面板 — 清單 + 彈出式視窗

左側是一份 **agent 清單**(主 agent + 各 subagent),每列顯示名稱 / 狀態 / 步數 / subagent 數。
**點任一列 → 置中彈窗**攤開那個 agent 的完整任務;彈窗頂部用 chip 列出它指派的 subagent(點 chip 同窗切換),
頭部有「上一個 / 下一個」與「`目前 / 總數`」位置,按 `←` `→` 或方向鍵切換,`Esc` / 點灰底 / ✕ 關閉。

彈窗內每一步依 ReAct 呈現,讓你看得出 agent **為什麼**這樣做:

- 💡 **想法(理由)** — agent 動手前那句敘述(例:「先看專案結構,確認是不是空的」)。一句理由對**整批**工具顯示一次。
- 🔧 **動作** — 工具與關鍵參數(Bash 指令 / 檔名 / skill 名 / MCP…),左側圓點是狀態(執行中 / 完成 / 錯誤)。
- **結果摘要** — 工具輸出的第一行(過長會截斷);點「▸ 展開輸出」看完整結果。

> 理由來源是 agent 自己的敘述文字(操控、觀察兩種模式都有)。模型的「內心思考」(extended thinking)在逐字稿裡
> 是被清空的,無法顯示。沒有前置敘述的工具就只顯示動作,屬正常。

**合理性分析(⚖)**:在彈窗內點 **「分析合理性」**,會把**這個 agent** 的 ReAct 軌跡交給**另一個
Claude**(獨立的審查 session,不會動到正在觀察/操控的 agent)。它回傳結構化判定 —— **妥當 / 有疑慮 /
有問題** —— 加一段總評,以及一份指摘清單:每項有嚴重度(高/中/低)、對應的步驟(可點,捲到並高亮那筆
工作項目),與建議做法。走無狀態的 `POST /analyze`;結果以 agent 為單位在 session 內快取(不落地儲存),
操控、觀察兩種模式都能用。

右側「對話」欄則只留**真對話**:你的任務指令 + agent 給你的總結/回答(逐步細節都在左側彈窗,不洗版對話)。

## 測試

```bash
npm test            # 後端單元測試 (vitest, 66)
cd web && npm test  # 前端單元測試 (vitest + jsdom, 33)
```

型別檢查:`npx tsc --noEmit`(根與 `web/` 各自)。

## 端到端驗證

```bash
# 先讓後端在跑 (npm run dev),再於另一終端:
npx tsx spike/e2e.ts
```

`spike/e2e.ts` 模擬前端跑完整閉環:連 WS → `/start` → 遇 `await:tool` 自動核准 → 觀察節點轉 `done`。
`spike/probe.ts`(`npm run spike`)則是直接印出 SDKMessage 原始形狀,用來校正對 SDK 的假設。

## 專案結構

```
src/                    後端
  server.ts             Express + WebSocketServer;/start /control /sessions /observe /new-agent;連上即送 snapshot
  sourceController.ts   管理「來源 + 模式」:operate(Route B)↔ observe(Route A)切換、reset+重送 snapshot
  sessionManager.ts     Route B 狀態核心:啟動、canUseTool 核准閘、暫停、派任務(輸入佇列)
  agentAdapter.ts       包 Agent SDK query();橋接 abort、對接 canUseTool 的 toolUseID
  translator.ts         純函式:SDK 串流 SDKMessage → 前端事件(樹節點 / 狀態 / 日誌 / 敘述)
  translateTranscript.ts 純函式:Claude 逐字稿一筆記錄 → 前端事件(parentId 由外部傳入)
  reactAssembler.ts     把 assistant 敘述配對成工具的 reason(想法→動作);沒配到的 flush 成對話總結
  transcriptSource.ts   Claude Route A tailer:backfill + 輪詢新增行 + subagent 子檔連結;pickLatestSession
  sessions.ts           列 ~/.claude/projects 的可觀察 session(listSessions);firstCwd 取工作目錄
  sourceSystems.ts      依 system(claude/antigravity)分派觀察來源、工作目錄、session 列舉
  antigravityProto.ts   Antigravity conversation .db 的 protobuf step 解碼(泛型萃取,不需 .proto)
  translateAntigravity.ts 純函式:一筆已解碼 step → 前端事件(toolSummary→動作、toolAction→reason)
  antigravitySource.ts  Antigravity Route A tailer:開 .db、以 steps.idx 當游標輪詢新步驟
  antigravitySessions.ts 列 ~/.gemini/antigravity/conversations 的對話(身分 / 步數 / 工作目錄)
  snapshot.ts           SnapshotStore:套用事件、維護 seq / nodes / logs / messages;reset()
  types.ts              共用型別(FrontendEvent / TreeNode / ControlCommand …)
web/src/                前端 (Vite + React)
  store.ts              純函式 reducer applyPacket:snapshot 初始化 + seq 去重 + 事件套用 + mode
  buildAgentBlocks.ts   扁平節點 → 每個 agent 一個區塊(可展開工具 / MCP、subagent 為子區塊)
  useSession.ts         WebSocket 生命週期(1 秒重連)+ 控制/切換指令 + 樂觀更新
  components/           AgentList · AgentModal · Conversation · ApprovalModal · SourcePicker
docs/superpowers/       設計 spec 與實作計畫
NOTES.md                SDK / 逐字稿觀察筆記(spike 實測校正結果)
```

## 已知限制

- **觀察模式(Route A)是唯讀的**:逐字稿是歷史紀錄,沒有 pending 核准,所以觀察時不會有核准框,
  也不能暫停 / 派任務。只有操控模式(Route B)能介入。
- 後端 snapshot **不含 pending 核准**。操控模式下若「斷線時剛好有核准等待中」,重連後無法從 snapshot 還原核准框
  (前端已把該節點標為 🟡 awaiting 作為部分補償)。完整修復需後端序列化 pending。
- **操控模式的「暫停」是「中止目前執行」而非「續原對話」**:pause 會中斷進行中的工具(節點轉 error)並讓 agent 停手,
  之後可用輸入框啟動**新**任務(pause 已重建 AbortController + 清輸入佇列)。但 abort 後 SDK 對話已丟,
  無法延續同一對話——要延續請直接用「派新任務」而不要先 pause(見 `NOTES.md`)。
- 一次觀察 / 操控**一個** session(切換時整個換掉);成本 / token 統計、任務看板為刻意排除的擴充點(YAGNI)。
```
