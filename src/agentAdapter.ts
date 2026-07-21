import { query } from '@anthropic-ai/claude-agent-sdk'

type Decision =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string }

type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>

// agent 操作的工作目錄。預設 process.cwd(),可用 AGENT_WORKSPACE 覆寫,
// 好處:(1) 從任何目錄啟動 server 都指向正確專案;(2) 可把 visualizer 指向任一目標專案。
export function resolveWorkspace(): string {
  const w = process.env.AGENT_WORKSPACE?.trim()
  return w ? w : process.cwd()
}

// 建構傳給 SDK query() 的 options(抽出以便單元測試,不需真的呼叫 SDK)。
export function buildOptions(canUseTool: CanUseTool, abortController: AbortController, cwd?: string): any {
  return {
    // 有帶 cwd(例如每個 session 選定的工作目錄)就用它,否則沿用原本的 pin 邏輯。
    cwd: cwd ?? resolveWorkspace(),
    abortController,
    canUseTool: async (toolName: string, input: any, opts: any) => {
      // toolUseID 大寫(SDK 型別);缺漏時以工具名 + 時間戳當暫時 id(理論上不會發生)。
      const toolUseId = opts?.toolUseID ?? `${toolName}-${Date.now()}`
      console.log('[agentAdapter] canUseTool', toolName, toolUseId)
      return canUseTool(toolName, input, { toolUseId })
    },
  }
}

// 把 SDK 的 query() 包成 SessionManager 需要的 RunQuery 介面。
// ✅ 已依 spike + SDK 型別定義(node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts)校正:
//   - canUseTool 的第三參數欄位是 `toolUseID`(大寫 ID),值即 tool_use block 的 `toolu_...` id。
//   - 中止用 Options.abortController;此處把外部 signal 橋接成 SDK 需要的 AbortController。
//   - cwd 明確 pin 到 resolveWorkspace(),避免依賴啟動當下的 process.cwd()。
export const realRunQuery = ({
  prompt,
  canUseTool,
  signal,
  cwd,
}: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
  cwd?: string
}): AsyncIterable<any> => {
  // 外部只給我們一個 signal,SDK 卻要整個 AbortController,橋接兩者。
  const abortController = new AbortController()
  if (signal.aborted) abortController.abort()
  else signal.addEventListener('abort', () => abortController.abort(), { once: true })

  const options = buildOptions(canUseTool, abortController, cwd)
  console.log('[agentAdapter] workspace cwd =', options.cwd)
  return query({ prompt, options } as any) as AsyncIterable<any>
}
