import { describe, it, expect, vi } from 'vitest'
import { SourceController } from '../src/sourceController'
import { SnapshotStore } from '../src/snapshot'
import type { FrontendEvent } from '../src/types'

// 假的 TranscriptSource:start() 時把預設事件同步餵給 emit(模擬 backfill),stop() 記錄。
function fakeSourceFactory(events: FrontendEvent[]) {
  const made: any[] = []
  const make = (file: string, emit: (e: FrontendEvent[]) => void) => {
    const src = { file, started: false, stopped: false, emit, start() { this.started = true; emit(events) }, stop() { this.stopped = true } }
    made.push(src)
    return src as any
  }
  return { make, made }
}

const node = (id: string): FrontendEvent => ({ kind: 'tree:node', node: { id, parentId: null, type: 'tool', label: id, status: 'running' } })

describe('SourceController', () => {
  it('預設是 control 模式,snapshot() 帶 mode/workspace', () => {
    const store = new SnapshotStore()
    const c = new SourceController(store, () => {}, () => 'C:/work')
    expect(c.mode).toBe('control')
    expect(c.snapshot()).toMatchObject({ type: 'snapshot', mode: 'control', workspace: 'C:/work' })
  })

  it('observe:先 reset store、進 observe 模式、backfill 灌進 store,最後只廣播一份 snapshot', () => {
    const store = new SnapshotStore()
    store.apply(node('old')) // 舊資料應被清掉
    const broadcasts: any[] = []
    const onEnterObserve = vi.fn()
    const c = new SourceController(store, (p) => broadcasts.push(p), () => 'C:/work', onEnterObserve)

    const { make, made } = fakeSourceFactory([node('n1'), node('n2')])
    c.observe('C:/proj/s.jsonl', make)

    expect(onEnterObserve).toHaveBeenCalledOnce() // 進 observe 前先叫停 control agent
    expect(c.mode).toBe('observe')
    expect(made[0].started).toBe(true)
    // backfill 期間不逐一廣播 event,只在最後送一份 snapshot
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].type).toBe('snapshot')
    expect(broadcasts[0].mode).toBe('observe')
    // 舊節點被清掉,只剩 backfill 的兩個
    expect(broadcasts[0].nodes.map((n: any) => n.id)).toEqual(['n1', 'n2'])
  })

  it('observe 後,source 之後 emit 的事件會即時廣播(live tail)', () => {
    const store = new SnapshotStore()
    const broadcasts: any[] = []
    const c = new SourceController(store, (p) => broadcasts.push(p), () => 'C:/work')
    const { make, made } = fakeSourceFactory([node('n1')])
    c.observe('s.jsonl', make)
    broadcasts.length = 0 // 清掉 backfill 的 snapshot

    made[0].emit([node('live1')]) // 模擬輪詢到新行
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toMatchObject({ type: 'event', event: { kind: 'tree:node' } })
  })

  it('toControl:停掉 source、reset、回 control,廣播空 snapshot', () => {
    const store = new SnapshotStore()
    const broadcasts: any[] = []
    const c = new SourceController(store, (p) => broadcasts.push(p), () => 'C:/work')
    const { make, made } = fakeSourceFactory([node('n1')])
    c.observe('s.jsonl', make)
    broadcasts.length = 0

    c.toControl()
    expect(made[0].stopped).toBe(true)
    expect(c.mode).toBe('control')
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toMatchObject({ type: 'snapshot', mode: 'control', workspace: 'C:/work', nodes: [] })
  })

  it('toControl(cwd) 設定 workspace 與 controlCwd;無 cwd 用預設', () => {
    const store = new SnapshotStore()
    const ctrl = new SourceController(store, () => {}, () => 'C:/default')
    ctrl.toControl('C:/picked')
    expect(ctrl.workspace).toBe('C:/picked')
    expect(ctrl.controlCwd()).toBe('C:/picked')
    ctrl.toControl()
    expect(ctrl.workspace).toBe('C:/default')
    expect(ctrl.controlCwd()).toBeUndefined()
  })
})
