# SDKMessage 觀察筆記

> ⚠️ **狀態:PENDING spike 驗證。** 目前尚無 Anthropic 憑證(`ant` CLI 未安裝、`ANTHROPIC_API_KEY` 未設),
> spike(`npm run spike`)尚未實跑。以下為**基於 `@anthropic-ai/claude-agent-sdk` 已知結構的假設**,
> Task 2–8 的 fixture 依此撰寫。**備妥憑證後請跑 `npm run spike`,以實際輸出校正本檔與相關 fixture / 型別。**

## 假設中的 5 個觀察點

1. **訊息型別 (`type`)**:預期為 `'assistant'` | `'user'` | `'result'` | `'system'`。
   - `system` 的 `subtype: 'init'` 出現在最前。
   - `result` 出現在最後(整回合結束)。

2. **父子關係 (`parent_tool_use_id`)**:預期每則 `SDKMessage` 都帶此欄位(top-level)。
   - 主 agent 的訊息:`parent_tool_use_id === null`。
   - subagent(由 `Task` 工具派出)內部的訊息:`parent_tool_use_id === <派它的 Task tool_use 的 id>`。
   - → 這是建構樹狀父子關係的依據。

3. **工具呼叫 (`tool_use`)**:`assistant` 訊息的 `message.content` 是 blocks 陣列,
   其中 `tool_use` block 欄位為 `{ type:'tool_use', id, name, input }`。

4. **工具結果 (`tool_result`)**:`user` 訊息的 `message.content` 內有
   `{ type:'tool_result', tool_use_id, content, is_error }`。

5. **skill 呈現**:預期 skill 呼叫以 `tool_use` 出現、`name === 'Skill'`;
   subagent 派發以 `name === 'Task'`。(Translator 的 `toolTypeOf` 據此對應。)

6. **中止行為**:`AbortController.abort()` 後,`for await` 迴圈預期以丟錯結束
   (SessionManager 的 try/catch 會接住並轉成 `session_error`)。

## 校正紀錄(跑完 spike 後填寫)

- [ ] 確認 `parent_tool_use_id` 欄位名與位置
- [ ] 確認 `tool_use` / `tool_result` 欄位名
- [ ] 確認 `canUseTool` 回呼是否提供 `toolUseId`(影響 `src/agentAdapter.ts` 的 toolUseId 取得方式)
- [ ] 確認 skill 呼叫的實際 tool name
- [ ] 確認 abort 後的結束方式(丟錯 vs 收到 result)
