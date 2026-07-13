import { query } from '@anthropic-ai/claude-agent-sdk'

type Decision =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string }

// 把 SDK 的 query() 包成 SessionManager 需要的 RunQuery 介面。
// ⚠️ 依 NOTES.md(spike 產出)校正:canUseTool 的 toolUseId 來源、abortController 接法。
export const realRunQuery = ({
  prompt,
  canUseTool,
}: {
  prompt: AsyncIterable<any>
  canUseTool: (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>
  signal: AbortSignal
}): AsyncIterable<any> => {
  const options: any = {
    canUseTool: async (toolName: string, input: any, opts: any) => {
      // toolUseId 來源:優先用 opts 提供的欄位;否則以工具名 + 時間戳當暫時 id。以 NOTES.md 為準修正。
      const toolUseId = opts?.toolUseId ?? opts?.tool_use_id ?? `${toolName}-${Date.now()}`
      return canUseTool(toolName, input, { toolUseId })
    },
  }
  return query({ prompt, options } as any) as AsyncIterable<any>
}
