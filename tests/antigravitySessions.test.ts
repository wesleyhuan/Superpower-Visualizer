import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listAntigravitySessions } from '../src/antigravitySessions'

// 真實 trajectory_metadata_blob 是 protobuf(身分是其中一個 string 欄位),故 fixture 也 protobuf 編碼。
function varint(n: number): number[] { const b: number[] = []; while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n >>>= 7 } b.push(n); return b }
function pbStr(fieldNo: number, s: string): Buffer { const by = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from(varint((fieldNo << 3) | 2)), Buffer.from(varint(by.length)), by]) }

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agsess-'))
  const db = new DatabaseSync(join(dir, 'conv1.db'))
  db.exec(`CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INT, status INT, step_payload BLOB);
           CREATE TABLE trajectory_metadata_blob(id TEXT PRIMARY KEY, data BLOB);`)
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(0, 14, 3, Buffer.from('x'))
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(1, 8, 3, Buffer.from('x'))
  const identBlob = Buffer.concat([pbStr(1, 'teamwork_preview_orchestrator'), pbStr(2, 'Pure orchestrator.')])
  db.prepare('INSERT INTO trajectory_metadata_blob VALUES (?,?)').run('main', identBlob)
  db.close()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('listAntigravitySessions', () => {
  it('列出 .db、帶身分與 step 數,system 標記為 antigravity', () => {
    const list = listAntigravitySessions(dir)
    expect(list).toHaveLength(1)
    expect(list[0].system).toBe('antigravity')
    expect(list[0].steps).toBe(2)
    expect(list[0].identity).toContain('orchestrator')
  })

  it('目錄不存在 → 回空陣列不 throw', () => {
    expect(listAntigravitySessions(join(dir, 'nope'))).toEqual([])
  })
})
