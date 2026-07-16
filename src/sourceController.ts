import { SnapshotStore } from './snapshot'
import { TranscriptSource, readWorkspace } from './transcriptSource'
import { ReActAssembler } from './reactAssembler'
import type { FrontendEvent } from './types'

export type Mode = 'control' | 'observe'
type Packet = { type: 'event'; seq: number; event: unknown } | Record<string, unknown>
type MakeSource = (file: string, emit: (events: FrontendEvent[]) => void) => TranscriptSource

// 管理「目前的事件來源」與模式切換,共用同一個 store + broadcast:
//  - control:外部(SessionManager)直接餵事件,這裡不介入。
//  - observe:建 TranscriptSource,backfill 期間先靜默灌進 store,最後只廣播一份 snapshot,
//    之後的 live tail 事件才逐一廣播。
export class SourceController {
  mode: Mode = 'control'
  workspace: string
  private source: TranscriptSource | null = null
  private backfilling = false

  constructor(
    private store: SnapshotStore,
    private broadcast: (packet: Packet) => void,
    private controlWorkspace: () => string,
    private onEnterObserve: () => void = () => {}, // 進 observe 前叫停正在跑的 control agent
    private assembler: ReActAssembler = new ReActAssembler(),
  ) {
    this.workspace = controlWorkspace()
  }

  // 事件流:先過 assembler(配 reason / flush 敘述),再進 store;backfill 期間靜默。
  private ingest(events: FrontendEvent[]): void {
    for (const ev of this.assembler.process(events)) {
      const { seq, event } = this.store.apply(ev)
      if (!this.backfilling) this.broadcast({ type: 'event', seq, event })
    }
  }

  isObserving(): boolean {
    return this.mode === 'observe'
  }

  // 給 WS 連線當下用:目前狀態的完整 snapshot 封包。
  snapshot(): Record<string, unknown> {
    return { type: 'snapshot', mode: this.mode, workspace: this.workspace, ...this.store.snapshot() }
  }

  broadcastSnapshot(): void {
    this.broadcast(this.snapshot())
  }

  observe(file: string, makeSource: MakeSource = (f, emit) => new TranscriptSource(f, emit)): void {
    console.log('[controller] 切換到 observe:', file)
    this.onEnterObserve()
    this.source?.stop()
    this.store.reset()
    this.assembler.reset()
    this.mode = 'observe'
    this.workspace = readWorkspace(file)

    this.backfilling = true
    this.source = makeSource(file, (events) => this.ingest(events))
    this.source.start() // backfill 同步跑完(第一個 tick),期間靜默灌 store
    // 收尾:把最後還沒配到工具的敘述 flush 成對話總結(完成的 session 常以總結結尾)。
    for (const ev of this.assembler.flushAll()) this.store.apply(ev)
    this.backfilling = false
    this.broadcastSnapshot() // 一次送出整份,避免 backfill 幾千筆 event 洗版
  }

  toControl(): void {
    console.log('[controller] 切換到 control')
    this.source?.stop()
    this.source = null
    this.store.reset()
    this.assembler.reset()
    this.mode = 'control'
    this.workspace = this.controlWorkspace()
    this.broadcastSnapshot()
  }
}
