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
