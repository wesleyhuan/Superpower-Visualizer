import { describe, it, expect } from 'vitest'
import { SnapshotStore } from '../src/snapshot'

describe('SnapshotStore', () => {
  it('apply tree:node 會加入節點,seq 從 1 遞增', () => {
    const s = new SnapshotStore()
    const r = s.apply({ kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } })
    expect(r.seq).toBe(1)
    expect(s.snapshot().nodes).toHaveLength(1)
    expect(s.snapshot().seq).toBe(1)
  })

  it('apply tree:status 會更新既有節點狀態', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } })
    s.apply({ kind: 'tree:status', id: 'a', status: 'done' })
    expect(s.snapshot().nodes[0].status).toBe('done')
  })

  it('log 會累積在緩衝', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'log', entry: { ts: 1, nodeId: 'a', text: 'hi', level: 'info' } })
    expect(s.snapshot().logs).toHaveLength(1)
  })

  it('message 會存進 messages 並出現在 snapshot', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'message', role: 'user', text: '重構登入' })
    s.apply({ kind: 'message', role: 'assistant', text: '好的' })
    expect(s.snapshot().messages).toEqual([
      { role: 'user', text: '重構登入' },
      { role: 'assistant', text: '好的' },
    ])
  })

  it('reset 會清空節點/日誌/訊息並把 seq 歸零(切換 session 用)', () => {
    const s = new SnapshotStore()
    s.apply({ kind: 'tree:node', node: { id: 'a', parentId: null, type: 'tool', label: 'x', status: 'running' } })
    s.apply({ kind: 'message', role: 'user', text: 'hi' })
    s.reset()
    const snap = s.snapshot()
    expect(snap).toEqual({ seq: 0, nodes: [], logs: [], messages: [] })
    // reset 後重新 apply,seq 又從 1 起
    expect(s.apply({ kind: 'log', entry: { ts: 1, nodeId: null, text: 'y', level: 'info' } }).seq).toBe(1)
  })
})
