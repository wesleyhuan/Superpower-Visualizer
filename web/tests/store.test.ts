import { describe, it, expect } from 'vitest'
import { initialState, applyPacket, resolvePending } from '../src/store'

describe('applyPacket: snapshot 與 seq 去重', () => {
  it('snapshot 會用其 nodes/logs/seq 重設 state', () => {
    const s = applyPacket(initialState(), {
      type: 'snapshot',
      seq: 5,
      nodes: [{ id: 'a', parentId: null, type: 'tool', label: 'x', status: 'done' }],
      logs: [{ ts: 1, nodeId: 'a', text: 'hi', level: 'info' }],
      workspace: '',
    })
    expect(s.seq).toBe(5)
    expect(s.nodes['a'].status).toBe('done')
    expect(s.logs).toHaveLength(1)
  })

  it('snapshot 會帶入 workspace 路徑', () => {
    const s = applyPacket(initialState(), {
      type: 'snapshot', seq: 1, nodes: [], logs: [], workspace: 'D:/proj',
    })
    expect(s.workspace).toBe('D:/proj')
  })

  it('seq ≤ 目前 seq 的事件會被丟棄', () => {
    let s = applyPacket(initialState(), { type: 'snapshot', seq: 5, nodes: [], logs: [], workspace: '' })
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

describe('applyPacket: await:tool 與 session:error', () => {
  it('await:tool 會加入 pending 並把對應節點設 awaiting', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Bash', status: 'running' } },
    })
    s = applyPacket(s, {
      type: 'event', seq: 2,
      event: { kind: 'await:tool', toolUseId: 'toolu_1', name: 'Bash', input: {} },
    })
    expect(s.pending).toHaveLength(1)
    expect(s.nodes['toolu_1'].status).toBe('awaiting')
  })

  it('session:error 會標記 ended、清空 pending、running/awaiting → failed', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } },
    })
    s = applyPacket(s, { type: 'event', seq: 2, event: { kind: 'await:tool', toolUseId: 'a', name: 'x', input: {} } })
    s = applyPacket(s, { type: 'event', seq: 3, event: { kind: 'session:error', message: 'boom' } })
    expect(s.sessionEnded).toBe(true)
    expect(s.errorMessage).toBe('boom')
    expect(s.pending).toHaveLength(0)
    expect(s.nodes['a'].status).toBe('failed')
  })
})

describe('resolvePending', () => {
  it('移除指定 toolUseId 的 pending', () => {
    let s = applyPacket(initialState(), {
      type: 'event', seq: 1,
      event: { kind: 'await:tool', toolUseId: 't1', name: 'x', input: {} },
    })
    s = resolvePending(s, 't1')
    expect(s.pending).toHaveLength(0)
  })
})
