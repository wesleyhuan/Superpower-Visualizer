import { describe, it, expect } from 'vitest'
import { translate } from '../src/translator'

describe('translate: assistant tool_use', () => {
  it('把一個 Bash tool_use 轉成 tree:node(tool)+ log', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    }
    const events = translate(msg)
    expect(events).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Bash: npm test', status: 'running' },
    })
    expect(events.some((e) => e.kind === 'log')).toBe(true)
  })
})
