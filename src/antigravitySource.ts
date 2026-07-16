import { DatabaseSync } from 'node:sqlite'
import type { FrontendEvent } from './types'
import { decodeStep } from './antigravityProto'
import { translateAntigravityStep } from './translateAntigravity'

// Route A(Antigravity):開對話 .db,以 steps.idx 當游標輪詢新 step。
// 比 tail 檔案更穩:idx 單調遞增,不必處理半行 / 檔案截斷。
export class AntigravitySource {
  private db: DatabaseSync | null = null
  private cursor = -1
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly file: string,
    private readonly emit: (evs: FrontendEvent[]) => void,
    private readonly pollMs = 400,
  ) {}

  start(): void {
    try { this.db = new DatabaseSync(this.file, { readOnly: true }) }
    catch (err) { console.error(`[antigravity] 開啟 db 失敗 ${this.file}:`, err); return }
    this.drain() // backfill
    this.timer = setInterval(() => this.drain(), this.pollMs)
  }

  private drain(): void {
    if (!this.db) return
    let rows: Array<{ idx: number; step_type: number; status: number; step_payload?: Uint8Array }>
    try {
      rows = this.db.prepare(
        'SELECT idx, step_type, status, step_payload FROM steps WHERE idx > ? ORDER BY idx',
      ).all(this.cursor) as typeof rows
    } catch (err) { console.error('[antigravity] 讀 steps 失敗:', err); return }
    if (!rows.length) return

    const events: FrontendEvent[] = []
    for (const r of rows) {
      const payload = r.step_payload ? Buffer.from(r.step_payload) : Buffer.alloc(0)
      const decoded = decodeStep(payload)
      events.push(...translateAntigravityStep({ idx: r.idx, step_type: r.step_type, status: r.status, decoded }, null))
      this.cursor = r.idx
    }
    console.log(`[antigravity] +${rows.length} steps → ${events.length} events(cursor=${this.cursor})`)
    if (events.length) this.emit(events)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    try { this.db?.close() } catch (err) { console.error('[antigravity] 關閉 db:', err) }
    this.db = null
  }
}
