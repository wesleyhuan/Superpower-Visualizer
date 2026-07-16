import { describe, it, expect } from 'vitest'
import { translateTranscript } from '../src/translateTranscript'

// Route A:Claude Code 逐字稿(.jsonl)一筆記錄 → FrontendEvent[]。
// 與 SDK 串流不同:parentId 由外部(main=null、subagent 檔=掛載點)傳入,
// schema 用 message.content 陣列 + 頂層 user 字串。

describe('translateTranscript: user 人類訊息', () => {
  it('字串 content 的 user 記錄 → message(role user)', () => {
    const rec = { type: 'user', message: { content: '幫我重構登入' } }
    expect(translateTranscript(rec, null)).toContainEqual({ kind: 'message', role: 'user', text: '幫我重構登入' })
  })

  it('isMeta 的 user 記錄不當成對話', () => {
    const rec = { type: 'user', isMeta: true, message: { content: '<system reminder>' } }
    expect(translateTranscript(rec, null).some((e) => e.kind === 'message')).toBe(false)
  })
})

describe('translateTranscript: assistant', () => {
  it('text block → assistant-text;tool_use → tree:node(不再補 tool_use log)', () => {
    const rec = {
      type: 'assistant',
      message: { content: [
        { type: 'text', text: '我先看結構。' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
      ] },
    }
    const events = translateTranscript(rec, null)
    expect(events).toContainEqual({ kind: 'assistant-text', parentId: null, text: '我先看結構。' })
    expect(events).toContainEqual({
      kind: 'tree:node',
      node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Bash: ls', status: 'running' },
    })
  })

  it('parentId 傳入時,tool_use 掛在該父節點下(subagent 檔情境)', () => {
    const rec = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_g', name: 'Grep', input: { pattern: 'x' } }] } }
    const node = (translateTranscript(rec, 'toolu_parent')[0] as any).node
    expect(node.parentId).toBe('toolu_parent')
  })
})

describe('translateTranscript: user tool_result 陣列', () => {
  it('成功結果 → tree:status done + log', () => {
    const rec = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'ok' }] } }
    const events = translateTranscript(rec, null)
    expect(events).toContainEqual({ kind: 'tree:status', id: 'toolu_1', status: 'done' })
    expect(events.some((e) => e.kind === 'log')).toBe(true)
  })

  it('is_error 結果 → tree:status error', () => {
    const rec = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' }] } }
    expect(translateTranscript(rec, null)).toContainEqual({ kind: 'tree:status', id: 'toolu_2', status: 'error' })
  })
})
