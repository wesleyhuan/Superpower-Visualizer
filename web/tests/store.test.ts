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
