// 探針:分析 Claude Code 的 session 逐字稿 (.jsonl),看能不能重建樹/對話。
// 用法:npx tsx spike/transcript-probe.ts <path-to.jsonl>
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('need a .jsonl path'); process.exit(1) }

const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
console.log(`檔案:${file}\n總行數:${lines.length}\n`)

const typeCount = new Map<string, number>()
const topKeys = new Set<string>()
const blockTypes = new Map<string, number>()
const toolNames = new Map<string, number>()
let withParent = 0, withSessionId = 0, withUuid = 0, withParentUuid = 0
const samples: Record<string, any> = {}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const line of lines) {
  let rec: any
  try { rec = JSON.parse(line) } catch { continue }
  for (const k of Object.keys(rec)) topKeys.add(k)
  const t = rec.type ?? '(none)'
  bump(typeCount, t)
  if ('parent_tool_use_id' in rec) withParent++
  if (rec.sessionId || rec.session_id) withSessionId++
  if (rec.uuid) withUuid++
  if (rec.parentUuid !== undefined) withParentUuid++

  const content = rec.message?.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b?.type) bump(blockTypes, b.type)
      if (b?.type === 'tool_use' && b?.name) bump(toolNames, b.name)
    }
  } else if (typeof content === 'string') {
    bump(blockTypes, 'string')
  }
  // 每種 type 存一筆樣本(keys + 精簡)
  if (!samples[t]) samples[t] = rec
}

console.log('=== top-level 欄位 union ===')
console.log([...topKeys].sort().join(', '))
console.log('\n=== 訊息 type 分布 ===')
for (const [k, v] of [...typeCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log('\n=== content block types ===')
for (const [k, v] of [...blockTypes].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log('\n=== tool_use 名稱 ===')
for (const [k, v] of [...toolNames].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
console.log('\n=== 關聯欄位 ===')
console.log(`  parent_tool_use_id 出現: ${withParent}`)
console.log(`  parentUuid 出現: ${withParentUuid}`)
console.log(`  uuid 出現: ${withUuid}`)
console.log(`  sessionId/session_id 出現: ${withSessionId}`)

// 印一筆 assistant + 一筆 user 的骨架(截斷長字串)
function skeleton(o: any, depth = 0): any {
  if (depth > 4) return '…'
  if (typeof o === 'string') return o.length > 60 ? o.slice(0, 60) + '…' : o
  if (Array.isArray(o)) return o.slice(0, 3).map((x) => skeleton(x, depth + 1))
  if (o && typeof o === 'object') {
    const r: any = {}
    for (const k of Object.keys(o)) r[k] = skeleton(o[k], depth + 1)
    return r
  }
  return o
}
console.log('\n=== 樣本:assistant ===')
console.log(JSON.stringify(skeleton(samples['assistant']), null, 2)?.slice(0, 1400))
console.log('\n=== 樣本:user ===')
console.log(JSON.stringify(skeleton(samples['user']), null, 2)?.slice(0, 1000))
