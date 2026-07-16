import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AntigravitySource } from '../src/antigravitySource'
import type { FrontendEvent } from '../src/types'

// 手工組一個工具 step 的 protobuf payload(view_file + toolAction)。
function varint(n: number): number[] { const b: number[] = []; while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n >>>= 7 } b.push(n); return b }
function str(fieldNo: number, s: string): Buffer { const by = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from(varint((fieldNo << 3) | 2)), Buffer.from(varint(by.length)), by]) }
function toolPayload(): Buffer {
  // toolAction(為什麼)≠ toolSummary(做什麼)→ reason 會帶 toolAction。
  const inner = Buffer.concat([str(1, 'abc'), str(2, 'view_file'), str(3, '{"toolAction":"Read the request","toolSummary":"Read x"}')])
  return Buffer.concat([Buffer.from(varint((4 << 3) | 2)), Buffer.from(varint(inner.length)), inner])
}

let dir: string, file: string, db: DatabaseSync
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agsrc-'))
  file = join(dir, 'c.db')
  db = new DatabaseSync(file)
  db.exec('CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INT, status INT, step_payload BLOB)')
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(0, 8, 3, toolPayload())
})
afterEach(() => { try { db.close() } catch { /* */ }; rmSync(dir, { recursive: true, force: true }) })

describe('AntigravitySource', () => {
  it('start() backfill 既有 steps → emit tree:node(帶 reason)', () => {
    const got: FrontendEvent[] = []
    const src = new AntigravitySource(file, (evs) => got.push(...evs), 999999)
    src.start(); src.stop()
    const node = got.find((e) => e.kind === 'tree:node') as any
    expect(node?.node.label).toContain('view_file')
    expect(node?.node.reason).toBe('Read the request')
  })

  it('游標只吃新增 step,不重複既有', () => {
    const got: FrontendEvent[] = []
    const src = new AntigravitySource(file, (evs) => got.push(...evs), 999999)
    src.start()
    const before = got.length
    db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(1, 8, 3, toolPayload())
    ;(src as unknown as { drain(): void }).drain() // 直接觸發一次輪詢
    src.stop()
    expect(got.length).toBe(before + 1)
  })
})
