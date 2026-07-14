# Superpower Visualizer

即時**監控並介入** Claude agent 開發過程的本地 Web App。UI 本身就是指揮官——透過
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) 啟動並驅動 agent,把它的
工具呼叫、subagent、skill 即時畫成一棵互動樹 + 一條活動日誌流,並讓你在它動手前**核准 / 拒絕**
需要權限的工具、隨時**暫停**、或**派新任務**。

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

- **下行**:agent 的每個事件經 `translate()` 轉成前端事件、進 `SnapshotStore`(帶單調遞增 `seq`),
  用 WebSocket 廣播。重連時先送 snapshot,再送增量事件;前端用 `seq` 去重。
- **上行**:核准 / 暫停 / 派任務以 HTTP POST 到 `/control`,啟動以 POST `/start`。
- **後端是唯一真相來源**。目前為**單一 session**(v1 範圍)。

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

開兩個終端:

```bash
# 終端 1 — 後端(:3001)
npm run dev

# 終端 2 — 前端(:5173)
cd web && npm run dev
```

瀏覽器開 <http://localhost:5173>,標題旁 🟢 代表已連上後端。在輸入框打一段任務
(例:`請用 Grep 找出所有 .ts 檔並用一個 subagent 總結`)→ 按「啟動 agent」。

**指定 agent 的工作目錄:** 後端預設讓 agent 在 `process.cwd()`(即啟動 `npm run dev` 的目錄)操作。
要監控**別的**專案時,用 `AGENT_WORKSPACE` 環境變數把 agent 的工作目錄指過去——agent 的 Read / Write / Bash
相對路徑都會以它為基準:

```bash
AGENT_WORKSPACE="D:/path/to/target-project" npm run dev
```

前端標題列會顯示目前的工作目錄(📁),讓你一眼確認 agent 在哪個專案動手。

**操作:**
- 樹上即時長出節點,狀態圖示:⏳ 執行中 · 🟡 等待核准 · ✅ 完成 · ❌ / 💥 錯誤。
- agent 要用**需權限的工具**(Bash / Write / Edit 等)時,下方出現核准框——按「核准」放行、「拒絕」擋下。
  (唯讀工具如 Read / Grep 在 default 權限模式自動放行,不會跳核准。)
- 「暫停」中止目前執行;「派新任務」把後續訊息排進 agent 的輸入佇列。

## 測試

```bash
npm test            # 後端單元測試 (vitest, 13)
cd web && npm test  # 前端單元測試 (vitest + jsdom, 15)
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
  server.ts             Express + WebSocketServer;/start、/control;連上即送 snapshot
  sessionManager.ts     狀態核心:啟動、canUseTool 核准閘、暫停、派任務(輸入佇列)
  agentAdapter.ts       包 Agent SDK query();橋接 abort、對接 canUseTool 的 toolUseID
  translator.ts         純函式:SDKMessage → 前端事件(樹節點 / 狀態 / 日誌)
  snapshot.ts           SnapshotStore:套用事件、維護 seq / nodes / logs
  types.ts              共用型別(FrontendEvent / TreeNode / ControlCommand …)
web/src/                前端 (Vite + React)
  store.ts              純函式 reducer applyPacket:snapshot 初始化 + seq 去重 + 事件套用
  buildTree.ts          扁平節點 → 巢狀樹(依 parent_tool_use_id)
  useSession.ts         WebSocket 生命週期(1 秒重連)+ 控制指令 POST + 樂觀更新
  components/           Tree · LogStream · ApprovalQueue · ControlBar
docs/superpowers/       設計 spec 與實作計畫
NOTES.md                SDK 觀察筆記(spike 實測校正結果)
```

## 已知限制(v1)

- 後端 snapshot 只含 nodes + logs,**不含 pending 核准**。若「斷線時剛好有核准等待中」,重連後無法從
  snapshot 還原核准框(前端已把該節點標為 🟡 awaiting 作為部分補償)。完整修復需後端序列化 pending。
- **「暫停」是「中止目前執行」而非「續原對話」**:pause 會中斷進行中的工具(節點轉 error)並讓 agent 停手,
  之後可用輸入框啟動**新**任務(pause 已重建 AbortController + 清輸入佇列)。但 abort 後 SDK 對話已丟,
  無法延續同一對話——要延續請直接用「派新任務」而不要先 pause(見 `NOTES.md`)。
- 單一 session;成本 / token 統計、任務看板為刻意排除的擴充點(YAGNI)。
```
