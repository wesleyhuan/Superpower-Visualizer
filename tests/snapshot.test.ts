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
})
