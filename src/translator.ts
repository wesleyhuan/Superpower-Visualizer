import type { FrontendEvent, NodeType } from './types'

// spike 校正:實際 SDK 的 subagent 工具名是 `Agent`(input 帶 subagent_type/description);
// 保留 `Task` 以相容舊版命名。
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

export function toolTypeOf(name: string): NodeType {
  if (SUBAGENT_TOOLS.has(name)) return 'subagent'
  if (name === 'Skill') return 'skill'
  return 'tool'
}

function labelFor(name: string, input: any): string {
  if (name === 'Bash' && input?.command) return `Bash: ${input.command}`
  if (name === 'Skill' && input?.command) return `skill: ${input.command}`
  if (SUBAGENT_TOOLS.has(name) && input?.description) return `subagent: ${input.description}`
  return name
}

export function translate(msg: any): FrontendEvent[] {
  const out: FrontendEvent[] = []
  const parentId: string | null = msg?.parent_tool_use_id ?? null

  if (msg?.type === 'assistant') {
    const blocks = msg.message?.content ?? []
    for (const b of blocks) {
      if (b?.type === 'tool_use') {
        const type = toolTypeOf(b.name)
        const label = labelFor(b.name, b.input)
        out.push({ kind: 'tree:node', node: { id: b.id, parentId, type, label, status: 'running' } })
        out.push({ kind: 'log', entry: { ts: Date.now(), nodeId: b.id, text: label, level: 'info' } })
      }
    }
  }
  if (msg?.type === 'user') {
    const blocks = msg.message?.content ?? []
    for (const b of blocks) {
      if (b?.type === 'tool_result') {
        const isError = !!b.is_error
        out.push({ kind: 'tree:status', id: b.tool_use_id, status: isError ? 'error' : 'done' })
        out.push({
          kind: 'log',
          entry: {
            ts: Date.now(),
            nodeId: b.tool_use_id,
            text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
            level: isError ? 'error' : 'info',
          },
        })
      }
    }
  }
  return out
}
