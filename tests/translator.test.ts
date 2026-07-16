import { describe, it, expect } from 'vitest'
import { translate } from '../src/translator'

describe('translate: assistant tool_use', () => {
  it('把一個 Bash tool_use 轉成 tree:node(tool);tool_use 不再補 log', () => {
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
    // log 只留給 tool_result(實際輸出),tool_use 不再產生 log
    expect(events.some((e) => e.kind === 'log')).toBe(false)
  })
})

describe('translate: assistant text → assistant-text(交給 ReActAssembler)', () => {
  it('assistant 的 text block 轉成 assistant-text 事件(帶 parentId)', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: '我先研究專案結構。' }] },
    }
    expect(translate(msg)).toContainEqual({ kind: 'assistant-text', parentId: null, text: '我先研究專案結構。' })
  })

  it('空白 text 不產生事件', () => {
    const msg = {
      type: 'assistant', parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: '   ' }] },
    }
    expect(translate(msg).some((e) => e.kind === 'assistant-text')).toBe(false)
  })
})

describe('translate: user tool_result', () => {
  it('成功結果 → tree:status done', () => {
    const msg = {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'ok' }] },
    }
    const events = translate(msg)
    expect(events).toContainEqual({ kind: 'tree:status', id: 'toolu_1', status: 'done' })
  })

  it('is_error 結果 → tree:status error + error log', () => {
    const msg = {
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' }] },
    }
    const events = translate(msg)
    expect(events).toContainEqual({ kind: 'tree:status', id: 'toolu_2', status: 'error' })
    expect(events.some((e) => e.kind === 'log' && e.entry.level === 'error')).toBe(true)
  })
})

describe('translate: subagent 掛載', () => {
  it('Task tool_use → subagent 節點', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: '研究登入流程' } }] },
    }
    expect(translate(msg)).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_task', parentId: null, type: 'subagent', label: 'subagent: 研究登入流程', status: 'running' },
    })
  })

  it('Skill tool_use → skill 節點,label 用 input.skill(spike 校正)', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_skill', name: 'Skill', input: { skill: 'superpowers:brainstorming' } }] },
    }
    expect(translate(msg)).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_skill', parentId: null, type: 'skill', label: 'skill: superpowers:brainstorming', status: 'running' },
    })
  })

  it('Agent tool_use → subagent 節點(spike 校正:真實工具名為 Agent 非 Task)', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: '總結 TypeScript 檔案', subagent_type: 'general-purpose' } }] },
    }
    expect(translate(msg)).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_agent', parentId: null, type: 'subagent', label: 'subagent: 總結 TypeScript 檔案', status: 'running' },
    })
  })

  it('subagent 內部的工具帶 parent_tool_use_id → 掛在 subagent 節點下', () => {
    const msg = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_task',
      message: { content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'auth' } }] },
    }
    const node = (translate(msg)[0] as any).node
    expect(node.parentId).toBe('toolu_task')
    expect(node.id).toBe('toolu_grep')
  })
})
