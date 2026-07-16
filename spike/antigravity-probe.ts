// Antigravity 逐字稿探針(唯讀):把一個 conversation .db 的 steps 解成 FrontendEvent[],
// 驗證「工具樹 + ReAct 理由」接不接得起來——對應當初驗 Claude 逐字稿的做法。
//
// 資料來源:~/.gemini/antigravity/conversations/<id>.db(每個對話一個 SQLite)。
// steps.step_payload / render_info 是 protobuf(二進位),但工具參數以 JSON 內嵌、
// assistant 思考以明文內嵌。這裡用「泛型 protobuf 字串萃取」把文字撈出來,不需 .proto。
//
// 跑法:npx tsx spike/antigravity-probe.ts [db路徑](省略則自動挑最近修改的對話)
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ReActAssembler } from '../src/reactAssembler'
import type { FrontendEvent, NodeStatus } from '../src/types'

// 沒指定路徑時,挑 conversations 目錄裡最近修改的 .db(避免寫死某個真實對話 UUID)。
function latestConversation(): string {
  const dir = join(homedir(), '.gemini', 'antigravity', 'conversations')
  const dbs = readdirSync(dir).filter((f) => f.endsWith('.db'))
    .map((f) => ({ f: join(dir, f), m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (!dbs.length) throw new Error(`找不到任何對話 .db:${dir}`)
  return dbs[0].f
}

const dbPath = process.argv[2] ?? latestConversation()

// ── 泛型 protobuf 走訪:遞迴 length-delimited 欄位,把「像文字的葉節點」收集起來 ──
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0, p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return [result, p]
    shift += 7
    if (shift > 56) break // 超過安全整數範圍,放棄(理由:JS number 精度)
  }
  return [result, p]
}

// 判斷一段 bytes 是不是「文字葉節點」(JSON 或散文),而非巢狀 message。
function asText(b: Buffer): string | null {
  if (b.length < 3) return null
  let s: string
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null }
  let printable = 0
  for (const ch of s) { const c = ch.codePointAt(0)!; if (c >= 0x20 || c === 0x0a || c === 0x09) printable++ }
  if (printable / [...s].length < 0.92) return null // 巢狀 message 會夾雜控制碼 → 判為非文字
  return s
}

function harvest(buf: Buffer, out: string[], depth = 0): void {
  if (depth > 12) return
  let pos = 0
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos)
    if (p1 <= pos) break
    const wire = tag & 0x7
    pos = p1
    if (wire === 0) { pos = readVarint(buf, pos)[1] }          // varint
    else if (wire === 1) { pos += 8 }                           // 64-bit
    else if (wire === 5) { pos += 4 }                           // 32-bit
    else if (wire === 2) {                                      // length-delimited
      const [len, p2] = readVarint(buf, pos)
      pos = p2
      const sub = buf.subarray(pos, pos + len)
      pos += len
      const t = asText(sub)
      if (t !== null) out.push(t)   // 文字葉節點(工具 JSON / 散文)→ 收集,不再往下鑽
      else harvest(sub, out, depth + 1) // 否則當巢狀 message 遞迴
    } else break // 未知 wire type,停
  }
}

// ── step_type / status 語意(由實測校正) ──
const STATUS: Record<number, NodeStatus> = { 2: 'running', 3: 'done' }
const KNOWN_TOOLS = new Set([
  'view_file', 'write_to_file', 'run_command', 'find_by_name', 'list_dir',
  'invoke_subagent', 'schedule', 'replace_file_content', 'grep_search',
  'read_url_content', 'search_web', 'propose_code',
])

interface Parsed {
  toolName?: string
  args?: Record<string, unknown>
  narration?: string   // assistant 思考(type 15 明文)
  userText?: string    // 使用者任務(type 14)
}

function parseStep(stepType: number, payload: Buffer): Parsed {
  const texts: string[] = []
  harvest(payload, texts)
  const out: Parsed = {}

  // 工具參數:第一個能 parse 成物件、且帶 toolAction/toolSummary 或已知欄位的 JSON
  for (const s of texts) {
    if (!s.trimStart().startsWith('{')) continue
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object') { out.args = obj; break }
    } catch { /* 內嵌 JSON 可能被截,略過 */ }
  }
  // 工具名:snake_case 短識別字,且在已知工具集內
  out.toolName = texts.find((s) => /^[a-z][a-z_]{2,30}$/.test(s) && KNOWN_TOOLS.has(s))

  // assistant 思考:最長的散文(有空格、非 JSON、非路徑/uuid)
  const prose = texts
    .filter((s) => s.includes(' ') && !s.trimStart().startsWith('{') &&
      !s.includes('\\') && !/^[0-9a-f-]{20,}$/.test(s) && !s.includes('thinkingSignature'))
    .sort((a, b) => b.length - a.length)[0]
  if (stepType === 15 && prose && prose.length > 40) out.narration = prose
  if (stepType === 14 && prose) out.userText = prose

  return out
}

// ── 主流程 ──
console.log(`[probe] 讀取 ${dbPath}`)
let db: DatabaseSync
try {
  db = new DatabaseSync(dbPath, { readOnly: true })
} catch (err) {
  console.error('[probe] 開啟 DB 失敗:', err)
  process.exit(1)
}

const rows = db.prepare(
  'SELECT idx, step_type, status, has_subtrajectory, step_payload FROM steps ORDER BY idx',
).all() as Array<{ idx: number; step_type: number; status: number; has_subtrajectory: number; step_payload: Uint8Array | null }>

console.log(`[probe] steps 總數 ${rows.length}`)

const assembler = new ReActAssembler()
let toolNodes = 0, withNarration = 0, withToolAction = 0, subagents = 0, msgs = 0
const samples: string[] = []

function ingest(evs: FrontendEvent[]): void {
  for (const e of assembler.process(evs)) {
    if (e.kind === 'tree:node') {
      toolNodes++
      if (e.node.type === 'subagent') subagents++
      if (e.node.reason) withNarration++
      if (samples.length < 5) {
        samples.push(
          (e.node.reason ? `  💭 ${e.node.reason.replace(/\s+/g, ' ').slice(0, 90)}\n` : '') +
          `  🔧 ${e.node.label.slice(0, 70)}`,
        )
      }
    }
    if (e.kind === 'message') msgs++
  }
}

for (const r of rows) {
  const payload = r.step_payload ? Buffer.from(r.step_payload) : Buffer.alloc(0)
  const p = parseStep(r.step_type, payload)

  if (p.userText) { ingest([{ kind: 'message', role: 'user', text: p.userText }]); continue }
  if (p.narration) { ingest([{ kind: 'assistant-text', parentId: null, text: p.narration }]); continue }

  if (p.toolName || p.args) {
    const args = p.args ?? {}
    const action = (args['toolAction'] ?? args['toolSummary']) as string | undefined
    if (action) withToolAction++
    const isSub = p.toolName === 'invoke_subagent'
    const label = `${p.toolName ?? 'tool'}: ${action ?? p.toolName ?? ''}`.slice(0, 80)
    ingest([{
      kind: 'tree:node',
      node: {
        id: `ag-${r.idx}`, parentId: null,
        type: isSub ? 'subagent' : 'tool',
        label, status: STATUS[r.status] ?? 'done',
        // Antigravity 每個工具自帶 toolAction = 明文的「為什麼」。若前面沒接到 type-15 敘述,
        // 也還有這個當理由(assembler 只在沒 narration 時才會是 undefined)。
      },
    }])
    if (action && !samples.some((s) => s.includes('🎯'))) {
      samples.push(`  🎯 toolAction(工具自帶理由): ${action}`)
    }
  }
}
for (const e of assembler.flushAll()) if (e.kind === 'message') msgs++
db.close()

const pct = (n: number) => toolNodes ? `${((n / toolNodes) * 100).toFixed(0)}%` : '—'
console.log('\n────────── 結果 ──────────')
console.log(`工具節點 ${toolNodes}(其中 subagent ${subagents})`)
console.log(`有 narration 理由(type-15 配對) ${withNarration} (${pct(withNarration)})`)
console.log(`有 toolAction 理由(工具自帶) ${withToolAction} (${pct(withToolAction)})`)
console.log(`對話訊息(user + flush) ${msgs}`)
console.log('\n樣本:\n' + samples.join('\n\n'))
