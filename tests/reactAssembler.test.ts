import { describe, it, expect } from 'vitest'
import { ReActAssembler } from '../src/reactAssembler'
import type { FrontendEvent } from '../src/types'

const text = (parentId: string | null, t: string): FrontendEvent => ({ kind: 'assistant-text', parentId, text: t })
const tool = (id: string, parentId: string | null): FrontendEvent => ({ kind: 'tree:node', node: { id, parentId, type: 'tool', label: id, status: 'running' } })
const userMsg = (t: string): FrontendEvent => ({ kind: 'message', role: 'user', text: t })

// 抓出 tree:node 的 reason
const reasonOf = (evs: FrontendEvent[], id: string) =>
  (evs.find((e) => e.kind === 'tree:node' && (e as any).node.id === id) as any)?.node.reason

describe('ReActAssembler', () => {
  it('敘述後接工具 → 掛成該工具 reason,且不另外發對話訊息', () => {
    const a = new ReActAssembler()
    const out = a.process([text(null, '先看專案結構'), tool('t1', null)])
    expect(reasonOf(out, 't1')).toBe('先看專案結構')
    expect(out.some((e) => e.kind === 'message')).toBe(false)
  })

  it('一句理由對整批:只有該批第一個工具帶 reason,後續工具沒有', () => {
    const a = new ReActAssembler()
    const out = a.process([text(null, '批次讀檔'), tool('t1', null), tool('t2', null)])
    expect(reasonOf(out, 't1')).toBe('批次讀檔')
    expect(reasonOf(out, 't2')).toBeUndefined()
  })

  it('下一句理由開新批', () => {
    const a = new ReActAssembler()
    const out = a.process([text(null, '理由A'), tool('t1', null), text(null, '理由B'), tool('t2', null)])
    expect(reasonOf(out, 't1')).toBe('理由A')
    expect(reasonOf(out, 't2')).toBe('理由B')
  })

  it('敘述後沒接工具、遇到人類訊息 → flush 成 assistant 對話訊息(排在人類訊息前)', () => {
    const a = new ReActAssembler()
    const out = a.process([text(null, '已完成,棋盤可下'), userMsg('再幫我加計時器')])
    expect(out).toEqual([
      { kind: 'message', role: 'assistant', text: '已完成,棋盤可下' },
      { kind: 'message', role: 'user', text: '再幫我加計時器' },
    ])
  })

  it('沒有前置敘述的工具 → 沒有 reason', () => {
    const a = new ReActAssembler()
    const out = a.process([tool('t1', null)])
    expect(reasonOf(out, 't1')).toBeUndefined()
  })

  it('reason 依 parentId 分流:subagent 的敘述不會掛到主 agent 的工具', () => {
    const a = new ReActAssembler()
    const out = a.process([text('sub1', 'subagent 的想法'), tool('mainTool', null)])
    expect(reasonOf(out, 'mainTool')).toBeUndefined()
    // 主 agent 的工具沒吃到,subagent 的敘述仍留著,之後掛給 subagent 的工具
    const out2 = a.process([tool('subTool', 'sub1')])
    expect(reasonOf(out2, 'subTool')).toBe('subagent 的想法')
  })

  it('flushAll:把還沒配到工具的敘述變成 assistant 對話訊息', () => {
    const a = new ReActAssembler()
    a.process([text(null, '最後的總結')])
    const out = a.flushAll()
    expect(out).toEqual([{ kind: 'message', role: 'assistant', text: '最後的總結' }])
    expect(a.flushAll()).toEqual([]) // 清空後再 flush 不重複
  })

  it('多句連續敘述會併成一則 reason', () => {
    const a = new ReActAssembler()
    const out = a.process([text(null, '第一句'), text(null, '第二句'), tool('t1', null)])
    expect(reasonOf(out, 't1')).toBe('第一句\n第二句')
  })
})
