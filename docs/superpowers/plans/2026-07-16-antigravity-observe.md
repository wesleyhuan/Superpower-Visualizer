# Antigravity 觀察模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Google Antigravity 的 agent 逐字稿接進既有「觀察模式(Route A,唯讀)」,重建成同一套 ReAct 互動樹。

**Architecture:** 新增最左邊的來源轉譯層(protobuf 解碼 → 純函式 translate → SQLite 輪詢 source → session lister),右側 `SnapshotStore` / `ReActAssembler` / 前端資料流不動;`SourceController` / `/observe` / `/sessions` 加一個 `system: 'claude' | 'antigravity'` 維度。

**Tech Stack:** TypeScript、Node 內建 `node:sqlite`(不新增依賴)、vitest(後端 node env、前端 jsdom)。

## Global Constraints

- 逐字稿**唯讀**:所有 `DatabaseSync` 一律 `{ readOnly: true }`,絕不寫入使用者 Antigravity 資料。
- 錯誤不默默吞掉:所有 try/catch 用 `console.error` 印**實際 error** 並帶 `step.idx` / 檔名;未知 `step_type` 用 `console.debug`。
- 程式:精簡、優雅、易懂;函式短小、命名直白。
- git commit 訊息結尾:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 設計出處:`docs/superpowers/specs/2026-07-16-antigravity-observe-design.md`。v1 範圍:**扁平(一 db=一 agent 區塊)、reason=toolAction、type-15 思考先不顯示**。
- 測試 fixture 用**手工組的 protobuf / 合成小 .db**,不放使用者真實資料。

---

## Task 1:antigravityProto.ts — protobuf 解碼(風險最高、最該測)

**Files:**
- Create: `src/antigravityProto.ts`
- Test: `tests/antigravityProto.test.ts`

**Interfaces:**
- Produces:
  - `interface DecodedStep { toolName?: string; args?: Record<string, unknown>; text?: string }`
  - `function harvestStrings(buf: Buffer, out?: string[], depth?: number): string[]`
  - `function decodeStep(payload: Buffer): DecodedStep`

- [ ] **Step 1: 寫 protobuf 測試輔助 + 失敗測試**

`tests/antigravityProto.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { decodeStep, harvestStrings } from '../src/antigravityProto'

// 手工組 protobuf(privacy-safe,不用真實資料):varint tag + length-delimited。
function varint(n: number): number[] { const b: number[] = []; while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n >>>= 7 } b.push(n); return b }
function lenField(fieldNo: number, bytes: Buffer): Buffer {
  const tag = (fieldNo << 3) | 2
  return Buffer.concat([Buffer.from(varint(tag)), Buffer.from(varint(bytes.length)), bytes])
}
function str(fieldNo: number, s: string): Buffer { return lenField(fieldNo, Buffer.from(s, 'utf8')) }

describe('harvestStrings', () => {
  it('遞迴 length-delimited,撈出文字葉節點', () => {
    const nested = Buffer.concat([str(1, 'u2nlmji4'), str(2, 'view_file')])
    const payload = lenField(4, nested)
    expect(harvestStrings(payload)).toEqual(expect.arrayContaining(['u2nlmji4', 'view_file']))
  })
})

describe('decodeStep', () => {
  it('抽得到 toolName 與 args(內嵌 JSON)', () => {
    const json = '{"AbsolutePath":"C:\\\\x","toolAction":"Read original user request file","toolSummary":"Read x"}'
    const inner = Buffer.concat([str(1, 'u2nlmji4'), str(2, 'view_file'), str(3, json)])
    const d = decodeStep(lenField(4, inner))
    expect(d.toolName).toBe('view_file')
    expect((d.args as any).toolAction).toBe('Read original user request file')
  })

  it('抽得到 assistant/使用者散文(最長、非 JSON)', () => {
    const inner = Buffer.concat([str(1, 'Please read the user requirements in C:\\Users\\x\\REQ.md and summarise.')])
    expect(decodeStep(lenField(9, inner)).text).toContain('Please read the user requirements')
  })

  it('截斷的 JSON 不 crash,回無 args', () => {
    const inner = str(3, '{"AbsolutePath":"C:\\\\x","toolActi')  // 被截斷
    expect(() => decodeStep(lenField(4, inner))).not.toThrow()
    expect(decodeStep(lenField(4, inner)).args).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗** — `npm test -- antigravityProto`,預期 FAIL（模組不存在)。

- [ ] **Step 3: 實作 `src/antigravityProto.ts`**

```ts
// Antigravity 逐字稿的 step_payload 是 protobuf(二進位),工具參數以 JSON 字串、
// assistant/使用者散文以明文內嵌。這裡用泛型 wire-format 走訪把文字撈出來,不需 .proto。

export interface DecodedStep {
  toolName?: string
  args?: Record<string, unknown>
  text?: string // 最長散文(assistant 思考 / 使用者任務)
}

// 已知工具集(由探針校正;非窮舉,未知工具仍會被當 tool 處理)
const KNOWN_TOOLS = new Set([
  'view_file', 'write_to_file', 'run_command', 'find_by_name', 'list_dir',
  'invoke_subagent', 'schedule', 'replace_file_content', 'grep_search',
  'read_url_content', 'search_web', 'propose_code',
])

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0, p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return [result, p]
    shift += 7
    if (shift > 56) break // 超出 JS number 安全範圍,放棄
  }
  return [result, p]
}

// 判斷一段 bytes 是「文字葉節點」(JSON / 散文)還是巢狀 message。
function asText(b: Buffer): string | null {
  if (b.length < 3) return null
  let s: string
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null }
  const chars = [...s]
  let printable = 0
  for (const ch of chars) { const c = ch.codePointAt(0)!; if (c >= 0x20 || c === 0x0a || c === 0x09) printable++ }
  if (printable / chars.length < 0.92) return null // 巢狀 message 夾控制碼 → 判為非文字
  return s
}

export function harvestStrings(buf: Buffer, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let pos = 0
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos)
    if (p1 <= pos) break
    const wire = tag & 0x7
    pos = p1
    if (wire === 0) pos = readVarint(buf, pos)[1]
    else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos)
      pos = p2
      const sub = buf.subarray(pos, pos + len)
      pos += len
      const t = asText(sub)
      if (t !== null) out.push(t)
      else harvestStrings(sub, out, depth + 1)
    } else break // 未知 wire type,停
  }
  return out
}

export function decodeStep(payload: Buffer): DecodedStep {
  const texts = harvestStrings(payload)
  const out: DecodedStep = {}

  for (const s of texts) {
    if (!s.trimStart().startsWith('{')) continue
    try { const o = JSON.parse(s); if (o && typeof o === 'object') { out.args = o as Record<string, unknown>; break } }
    catch { /* 內嵌 JSON 可能被截斷,略過 */ }
  }
  out.toolName = texts.find((s) => /^[a-z][a-z_]{2,30}$/.test(s) && KNOWN_TOOLS.has(s))

  const prose = texts
    .filter((s) => s.includes(' ') && !s.trimStart().startsWith('{') &&
      !/^[0-9a-f-]{20,}$/i.test(s) && !s.includes('thinkingSignature'))
    .sort((a, b) => b.length - a.length)[0]
  if (prose) out.text = prose

  return out
}
```

- [ ] **Step 4: 跑測試確認通過** — `npm test -- antigravityProto`,預期 PASS。
- [ ] **Step 5: Commit** — `git add src/antigravityProto.ts tests/antigravityProto.test.ts && git commit`(訊息:`feat: antigravity protobuf step decoder`)。

---

## Task 2:translateAntigravity.ts — 純函式對映

**Files:**
- Create: `src/translateAntigravity.ts`
- Test: `tests/translateAntigravity.test.ts`

**Interfaces:**
- Consumes: `DecodedStep`(Task 1)、`FrontendEvent` / `NodeStatus`(`src/types.ts`)。
- Produces:
  - `interface DecodedRow { idx: number; step_type: number; status: number; decoded: DecodedStep }`
  - `function translateAntigravityStep(row: DecodedRow, parentId: string | null): FrontendEvent[]`

- [ ] **Step 1: 寫失敗測試**

`tests/translateAntigravity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { translateAntigravityStep } from '../src/translateAntigravity'

describe('translateAntigravityStep', () => {
  it('type 14 使用者任務 → message(user)', () => {
    const row = { idx: 0, step_type: 14, status: 3, decoded: { text: '幫我重構登入' } }
    expect(translateAntigravityStep(row, null)).toEqual([{ kind: 'message', role: 'user', text: '幫我重構登入' }])
  })

  it('工具 step → tree:node,reason=toolAction,status 由欄位對映', () => {
    const row = { idx: 2, step_type: 8, status: 3, decoded: { toolName: 'view_file', args: { toolAction: 'Read original user request file', toolSummary: 'Read x' } } }
    expect(translateAntigravityStep(row, null)).toEqual([{
      kind: 'tree:node',
      node: { id: 'ag-2', parentId: null, type: 'tool', label: 'view_file: Read x', status: 'done', reason: 'Read original user request file' },
    }])
  })

  it('invoke_subagent → subagent 節點', () => {
    const row = { idx: 23, step_type: 127, status: 2, decoded: { toolName: 'invoke_subagent', args: { toolSummary: '派 explorer' } } }
    const node = (translateAntigravityStep(row, null)[0] as any).node
    expect(node.type).toBe('subagent')
    expect(node.status).toBe('running')
  })

  it('type 15 assistant 思考 → v1 忽略(空陣列)', () => {
    const row = { idx: 8, step_type: 15, status: 3, decoded: { text: "I'm now drafting the plan..." } }
    expect(translateAntigravityStep(row, null)).toEqual([])
  })

  it('無法辨識的 step → 空陣列', () => {
    expect(translateAntigravityStep({ idx: 9, step_type: 99, status: 3, decoded: {} }, null)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗** — `npm test -- translateAntigravity`,預期 FAIL。

- [ ] **Step 3: 實作 `src/translateAntigravity.ts`**

```ts
import type { FrontendEvent, NodeStatus } from './types'
import type { DecodedStep } from './antigravityProto'

export interface DecodedRow { idx: number; step_type: number; status: number; decoded: DecodedStep }

// status:2=進行中、3=完成(由探針校正);其餘保守當 done。
const STATUS: Record<number, NodeStatus> = { 2: 'running', 3: 'done' }

export function translateAntigravityStep(row: DecodedRow, parentId: string | null): FrontendEvent[] {
  const { idx, step_type, status, decoded } = row

  if (step_type === 14 && decoded.text) return [{ kind: 'message', role: 'user', text: decoded.text }]
  if (step_type === 15) { console.debug(`[antigravity] 略過思考 step ${idx}`); return [] } // v1 不顯示 type-15

  const args = decoded.args ?? {}
  const action = (args.toolAction ?? args.toolSummary) as string | undefined
  if (decoded.toolName || action) {
    const isSub = decoded.toolName === 'invoke_subagent'
    const summary = (args.toolSummary ?? action ?? decoded.toolName ?? 'tool') as string
    return [{
      kind: 'tree:node',
      node: {
        id: `ag-${idx}`,
        parentId,
        type: isSub ? 'subagent' : 'tool',
        label: `${decoded.toolName ?? 'tool'}: ${summary}`.slice(0, 80),
        status: STATUS[status] ?? 'done',
        // Antigravity 每工具自帶 toolAction = 明文的「為什麼」,直接內嵌;不經 assembler 批次配對。
        ...(action ? { reason: action } : {}),
      },
    }]
  }

  console.debug(`[antigravity] 未對映 step ${idx} type ${step_type}`)
  return []
}
```

- [ ] **Step 4: 跑測試確認通過** — `npm test -- translateAntigravity`,預期 PASS。
- [ ] **Step 5: Commit**（`feat: antigravity step → FrontendEvent 純函式對映`）。

---

## Task 3:antigravitySessions.ts — 列可觀察對話

**Files:**
- Create: `src/antigravitySessions.ts`
- Test: `tests/antigravitySessions.test.ts`

**Interfaces:**
- Consumes: `decodeStep` / `harvestStrings`(Task 1)、`node:sqlite`。
- Produces:
  - `interface AntigravitySessionInfo { system: 'antigravity'; file: string; identity: string; cwd: string; mtime: number; steps: number }`
  - `function listAntigravitySessions(root?: string): AntigravitySessionInfo[]`
  - `function antigravityWorkspace(file: string): string`

- [ ] **Step 1: 寫失敗測試(用 node:sqlite 造合成 .db)**

`tests/antigravitySessions.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listAntigravitySessions } from '../src/antigravitySessions'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'agsess-'))
  // 造一個最小 steps 表,含身分 blob。payload 內容不影響 list(只數 step 數 + 身分)。
  const db = new DatabaseSync(join(dir, 'conv1.db'))
  db.exec(`CREATE TABLE steps(idx INTEGER PRIMARY KEY, step_type INT, status INT, step_payload BLOB);
           CREATE TABLE trajectory_metadata_blob(id TEXT PRIMARY KEY, data BLOB);`)
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(0, 14, 3, Buffer.from('x'))
  db.prepare('INSERT INTO steps VALUES (?,?,?,?)').run(1, 8, 3, Buffer.from('x'))
  db.prepare('INSERT INTO trajectory_metadata_blob VALUES (?,?)').run('main', Buffer.from('teamwork_preview_orchestrator', 'utf8'))
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
```

- [ ] **Step 2: 跑測試確認失敗** — `npm test -- antigravitySessions`,預期 FAIL。

- [ ] **Step 3: 實作 `src/antigravitySessions.ts`**

```ts
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { decodeStep, harvestStrings } from './antigravityProto'

export interface AntigravitySessionInfo {
  system: 'antigravity'
  file: string
  identity: string // 角色身分(orchestrator / explorer …)
  cwd: string
  mtime: number
  steps: number
}

function defaultRoot(): string {
  return join(homedir(), '.gemini', 'antigravity', 'conversations')
}

// 從 trajectory_metadata_blob('main') 撈角色身分(teamwork_* / *orchestrator* …)。
function readIdentity(db: DatabaseSync): string {
  try {
    const row = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get() as { data?: Uint8Array } | undefined
    if (!row?.data) return ''
    const texts = harvestStrings(Buffer.from(row.data))
    return texts.find((s) => /teamwork|orchestr|explorer|reviewer|auditor|agent/i.test(s))?.slice(0, 60) ?? ''
  } catch (err) { console.error('[antigravity] 讀身分失敗:', err); return '' }
}

// 掃前幾個 step 的工具參數,找第一個帶路徑欄位 → 取其目錄當工作目錄。
function readCwd(db: DatabaseSync): string {
  try {
    const rows = db.prepare('SELECT step_payload FROM steps ORDER BY idx LIMIT 20').all() as Array<{ step_payload?: Uint8Array }>
    for (const r of rows) {
      if (!r.step_payload) continue
      const args = decodeStep(Buffer.from(r.step_payload)).args as Record<string, unknown> | undefined
      const p = (args?.Cwd ?? args?.SearchDirectory ?? args?.DirectoryPath ?? args?.AbsolutePath) as string | undefined
      if (typeof p === 'string' && p) return args?.AbsolutePath ? dirname(p) : p
    }
  } catch (err) { console.error('[antigravity] 讀 cwd 失敗:', err) }
  return ''
}

export function listAntigravitySessions(root = defaultRoot()): AntigravitySessionInfo[] {
  let files: string[]
  try { files = readdirSync(root).filter((f) => f.endsWith('.db')) }
  catch (err) { console.error(`[antigravity] 列 conversations 失敗 ${root}:`, err); return [] }

  const out: AntigravitySessionInfo[] = []
  for (const f of files) {
    const file = join(root, f)
    let db: DatabaseSync | undefined
    try {
      const mtime = statSync(file).mtimeMs
      db = new DatabaseSync(file, { readOnly: true })
      const steps = (db.prepare('SELECT count(*) AS c FROM steps').get() as { c: number }).c
      out.push({ system: 'antigravity', file, identity: readIdentity(db), cwd: readCwd(db), mtime, steps })
    } catch (err) { console.error(`[antigravity] 讀 session 失敗 ${file}:`, err) }
    finally { try { db?.close() } catch { /* ignore */ } }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export function antigravityWorkspace(file: string): string {
  let db: DatabaseSync | undefined
  try { db = new DatabaseSync(file, { readOnly: true }); return readCwd(db) || file }
  catch (err) { console.error(`[antigravity] workspace 失敗 ${file}:`, err); return file }
  finally { try { db?.close() } catch { /* ignore */ } }
}
```

- [ ] **Step 4: 跑測試確認通過** — `npm test -- antigravitySessions`,預期 PASS。
- [ ] **Step 5: Commit**（`feat: 列 antigravity 可觀察對話 + 工作目錄推斷`）。

---

## Task 4:antigravitySource.ts — SQLite 輪詢 tailer

**Files:**
- Create: `src/antigravitySource.ts`
- Test: `tests/antigravitySource.test.ts`

**Interfaces:**
- Consumes: `decodeStep`(Task 1)、`translateAntigravityStep`(Task 2)、`FrontendEvent`。
- Produces: `class AntigravitySource { constructor(file: string, emit: (evs: FrontendEvent[]) => void, pollMs?: number); start(): void; stop(): void }`
- 注意:與 `TranscriptSource` 同形狀,`SourceController` 的 `makeSource` 可直接套。

- [ ] **Step 1: 寫失敗測試(合成 .db,含一個工具 payload)**

`tests/antigravitySource.test.ts`:
```ts
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
  const inner = Buffer.concat([str(1, 'abc'), str(2, 'view_file'), str(3, '{"toolAction":"Read x","toolSummary":"Read x"}')])
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
    expect(node?.node.reason).toBe('Read x')
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
```

- [ ] **Step 2: 跑測試確認失敗** — `npm test -- antigravitySource`,預期 FAIL。

- [ ] **Step 3: 實作 `src/antigravitySource.ts`**

```ts
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
```

- [ ] **Step 4: 跑測試確認通過** — `npm test -- antigravitySource`,預期 PASS。
- [ ] **Step 5: Commit**（`feat: antigravity SQLite 輪詢 tailer(idx 游標)`）。

---

## Task 5:後端接線 — system 維度(SourceController / server)

**Files:**
- Modify: `src/sourceController.ts`、`src/server.ts`
- Test: `tests/server.test.ts`、`tests/sourceController.test.ts`

**Interfaces:**
- Consumes: `listAntigravitySessions` / `antigravityWorkspace`(Task 3)、`AntigravitySource`(Task 4)。
- 既有 `SourceController.observe(file, makeSource)` → 加 `system` 與對應 `readWorkspace`。
- `SourceController.observe(file, makeSource, readWorkspace?)`:讓呼叫端注入取工作目錄的函式(Claude 用 `firstCwd||file`,Antigravity 用 `antigravityWorkspace`)。避免 controller 依賴具體系統。

- [ ] **Step 1: 先讀現有實作** — 讀 `src/sourceController.ts`(`observe` / `readWorkspace` 目前寫法)與 `src/server.ts`(`/observe`、`/sessions`、WS snapshot)。確認 `observe` 簽章與 `readWorkspace` 來源,對齊下面改法。

- [ ] **Step 2: 寫失敗測試(server 層)**

在 `tests/server.test.ts` 增:
```ts
it('GET /sessions?system=antigravity 回 antigravity 清單', async () => {
  // 用 monkeypatch / 注入點回傳假清單;若 server 直接呼叫 listAntigravitySessions,
  // 則以環境變數或注入的 root 指向暫存目錄(見既有 /sessions Claude 測試作法)。
  const res = await fetch(`${base}/sessions?system=antigravity`)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.sessions)).toBe(true)
})

it('POST /observe { system:"antigravity", file } 切到觀察且唯讀', async () => {
  // 指向 Task 4 風格的合成 .db;斷言回應 ok 且後續 snapshot.mode==="observe"
})
```
> 實作測試時比照 `tests/server.test.ts` 既有 `/sessions`、`/observe` 的建置方式(相同的 app 啟動 helper、暫存目錄注入)。若既有測試用固定 root,替 antigravity 加一個可注入 root 的相同機制。

- [ ] **Step 3: 跑測試確認失敗** — `npm test -- server`,預期新案 FAIL。

- [ ] **Step 4: 改 `src/sourceController.ts`** — `observe` 增第三參數 `readWorkspace: (file: string) => string`(預設沿用現有 Claude 版),observe 內用它算 workspace:
```ts
observe(file: string, makeSource: MakeSource, readWorkspace: (f: string) => string = this.claudeWorkspace): void {
  // …既有流程不變,只把 workspace 改成 readWorkspace(file)…
}
```
（`claudeWorkspace` = 目前已存在的 `readWorkspace`;若原本是模組級函式,改成建構子注入或保留為預設值。）

- [ ] **Step 5: 改 `src/server.ts`**
  - `GET /sessions`:讀 `req.query.system`;`=== 'antigravity'` → `listAntigravitySessions()`,否則 `listSessions()`(既有 Claude)。兩者都回 `{ sessions }`,每筆帶 `system`。
  - `POST /observe`:讀 body `{ system, file }`;
    ```ts
    if (system === 'antigravity') {
      controller.observe(file, (f, emit) => new AntigravitySource(f, emit), antigravityWorkspace)
    } else {
      controller.observe(file, (f, emit) => new TranscriptSource(f, emit), claudeWorkspace)
    }
    ```
  - imports:`AntigravitySource`、`listAntigravitySessions`、`antigravityWorkspace`。

- [ ] **Step 6: 跑後端全測** — `npm test`,預期全 PASS(48 + 新案)。
- [ ] **Step 7: Commit**（`feat: /sessions,/observe 支援 system=antigravity`）。

---

## Task 6:前端 — 先選系統再選 session

**Files:**
- Modify: `web/src/wireTypes.ts`、`web/src/useSession.ts`、`web/src/components/SourcePicker.tsx`、`web/src/App.tsx`、`web/vite.config.ts`(若 `/sessions` 需帶 query proxy,通常已涵蓋)
- Test: `web/tests/App.test.tsx`、（可加）`web/tests/SourcePicker.test.tsx`

**Interfaces:**
- Consumes: `GET /sessions?system=`、`POST /observe { system, file }`。
- `SessionInfo` 加 `system: 'claude' | 'antigravity'` 與 `identity?` / `steps?`(Antigravity 顯示用)。

- [ ] **Step 1: 先讀現有前端** — 讀 `web/src/components/SourcePicker.tsx`、`web/src/useSession.ts`、`web/src/wireTypes.ts`,確認目前 `observe(file)` / `loadSessions()` 與下拉結構。

- [ ] **Step 2: 寫失敗測試** — 在 `web/tests/App.test.tsx` 增:選「觀察 Antigravity 對話」→ 呼叫 `GET /sessions?system=antigravity`(mock fetch 斷言 query)、選一筆 → `POST /observe` body 含 `system:"antigravity"`;進入後輸入框停用(唯讀)。

- [ ] **Step 3: 跑測試確認失敗** — `cd web && npm test -- App`,預期 FAIL。

- [ ] **Step 4: 改 `wireTypes.ts`** — `SessionInfo` 加 `system: 'claude' | 'antigravity'`、`identity?: string`、`steps?: number`。

- [ ] **Step 5: 改 `useSession.ts`** — `loadSessions(system: 'claude' | 'antigravity')` 帶 query;`observe(system, file)` POST 帶 `system`。

- [ ] **Step 6: 改 `SourcePicker.tsx`** — 第一層系統選單:`＋ 新 Agent(操控)` / `觀察 Claude session` / `觀察 Antigravity 對話`;選觀察類 → `loadSessions(system)` 列該系統(Antigravity 顯示 `identity · steps 步 · relTime`),再選一筆 `observe(system, file)`。

- [ ] **Step 7: 改 `App.tsx`** — 傳新簽章;唯讀行為(`isObserving`)不因系統而異,沿用即可。

- [ ] **Step 8: 跑前端全測 + tsc** — `cd web && npm test`(預期 32 + 新案 PASS)、`npx tsc --noEmit`。
- [ ] **Step 9: Commit**（`feat: 來源選單先選系統(Claude / Antigravity)`）。

---

## Task 7:文件 + 端到端手動驗證

**Files:**
- Modify: `README.md`、`NOTES.md`

- [ ] **Step 1: README** — 觀察模式一節補「可觀察兩種系統:Claude Code(.jsonl)與 Antigravity(`~/.gemini/antigravity/conversations/*.db`)」;來源選單改「先選系統」;專案結構補 4 個新檔。
- [ ] **Step 2: NOTES** — 補「Antigravity 逐字稿實測」:SQLite+protobuf、toolAction=reason、subagent 為獨立 db(v1 扁平)、type-15 明文思考(v1 未用)。
- [ ] **Step 3: 手動 E2E** — 啟動前後端,來源選「觀察 Antigravity 對話」,選一個真實對話,確認互動樹長出、💡 想法(toolAction)有顯示、唯讀。用 Playwright MCP 截圖驗左側面板不空(比照先前 min-width:0 的驗證)。
- [ ] **Step 4: Commit**（`docs: Antigravity 觀察模式使用方式 + 實測筆記`）。

---

## Self-Review 檢查(撰寫者已核)

- **Spec 覆蓋**:proto 解碼 / translate / source / sessions / system 接線(前後端)/ 文件,對應 Task 1–7。
- **型別一致**:`DecodedStep`(Task1)→ `DecodedRow.decoded`(Task2)→ source 組出(Task4);`AntigravitySessionInfo.system` 與前端 `SessionInfo.system` 對齊字面量 `'antigravity'`;`AntigravitySource` 與 `TranscriptSource` 同 `{start,stop}` 形狀,`makeSource` 共用。
- **無 placeholder**:核心檔(proto/translate/source/sessions)給完整程式;Task5/6 因需對齊既有寫法,列出精確改點並要求先讀既有檔(Step 1)再改。
