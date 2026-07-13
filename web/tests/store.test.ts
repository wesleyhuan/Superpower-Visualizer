import { describe, it, expect } from 'vitest'
import { initialState, applyPacket } from '../src/store'

describe('applyPacket: snapshot 與 seq 去重', () => {
  it('snapshot 會用其 nodes/logs/seq 重設 state', () => {
    const s = applyPacket(initialState(), {
      type: 'snapshot',
      seq: 5,
      nodes: [{ id: 'a', parentId: null, type: 'tool', label: 'x', status: 'done' }],
      logs: [{ ts: 1, nodeId: 'a', text: 'hi', level: 'info' }],
    })
    expect(s.seq).toBe(5)
    expect(s.nodes['a'].status).toBe('done')
    expect(s.logs).toHaveLength(1)
  })

  it('seq ≤ 目前 seq 的事件會被丟棄', () => {
    let s = applyPacket(initialState(), { type: 'snapshot', seq: 5, nodes: [], logs: [] })
    s = applyPacket(s, {
      type: 'event', seq: 5,
      event: { kind: 'tree:node', node: { id: 'z', parentId: null, type: 'tool', label: 'z', status: 'running' } },
    })
    expect(s.nodes['z']).toBeUndefined() // 被去重丟棄
    expect(s.seq).toBe(5)
  })
})

describe('applyPacket: tree/log 事件', () => {
  const withSeq0 = () => initialState()
  it('tree:node 新增節點並記錄順序', () => {
    const s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    expect(s.nodes['a']).toBeDefined()
    expect(s.order).toEqual(['a'])
  })
  it('tree:status 更新既有節點', () => {
    let s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    s = applyPacket(s, { type: 'event', seq: 2, event: { kind: 'tree:status', id: 'a', status: 'done' } })
    expect(s.nodes['a'].status).toBe('done')
  })
  it('log 會 append', () => {
    const s = applyPacket(withSeq0(), {
      type: 'event', seq: 1,
      event: { kind: 'log', entry: { ts: 1, nodeId: 'a', text: 'hi', level: 'info' } },
    })
    expect(s.logs).toHaveLength(1)
  })
})
