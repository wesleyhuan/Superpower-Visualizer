// PoC:從 Claude Code 逐字稿重建「互動樹 + 對話」,證明 Route A(旁觀外部 session)可行。
// 用法:npx tsx spike/transcript-rebuild.ts <main-session.jsonl>
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

const main = process.argv[2]
if (!main) { console.error('need main .jsonl'); process.exit(1) }

const kindOf = (name: string) =>
  name === 'Agent' || name === 'Task' ? 'subagent'
    : name === 'Skill' ? 'skill'
    : /^mcp__/.test(name) ? 'mcp' : 'tool'

interface Node { kind: string; label: string; agentId?: string; childCount?: number }

function parse(file: string) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
  const tools: Node[] = []
  const convo: { role: string; text: string }[] = []
  // 建 tool_use id → 節點,之後用 tool_result 的 toolUseResult.agentId 補上 subagent 檔連結
  const byId = new Map<string, Node>()
  for (const l of lines) {
    let r: any; try { r = JSON.parse(l) } catch { continue }
    const c = r.message?.content
    if (r.type === 'user') {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : ''
      if (text.trim() && !r.isMeta) convo.push({ role: 'user', text: text.trim() })
    }
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text?.trim()) convo.push({ role: 'assistant', text: b.text.trim() })
        if (b.type === 'tool_use') {
          const node: Node = { kind: kindOf(b.name), label: b.input?.description || b.input?.command || b.input?.file_path || b.input?.skill || b.name }
          tools.push(node); byId.set(b.id, node)
        }
      }
    }
    // tool_result 頂層帶 toolUseResult.agentId → 連到 subagent 檔
    if (r.toolUseResult?.agentId) {
      const target = [...byId.entries()].find(([, n]) => n.kind === 'subagent' && !n.agentId)
      // 用 tool_result 的 tool_use_id 精準對應
      const tid = Array.isArray(c) ? c.find((b: any) => b.type === 'tool_result')?.tool_use_id : undefined
      const node = tid ? byId.get(tid) : target?.[1]
      if (node) node.agentId = r.toolUseResult.agentId
    }
  }
  return { tools, convo }
}

const { tools, convo } = parse(main)
const subDir = join(dirname(main), basename(main, '.jsonl'), 'subagents')

console.log(`\n===== 重建自:${basename(main)} =====\n`)
console.log(`工具呼叫總數:${tools.length}  |  對話訊息:${convo.length}\n`)

console.log('----- 互動樹(前 25 個節點)-----')
let shown = 0
for (const t of tools) {
  if (shown++ >= 25) break
  const tag = t.kind === 'subagent' ? 'SUB ' : t.kind === 'skill' ? 'SKILL' : t.kind === 'mcp' ? 'MCP ' : 'TOOL'
  let line = `  [${tag}] ${t.label.slice(0, 56)}`
  if (t.kind === 'subagent' && t.agentId) {
    const f = join(subDir, `agent-${t.agentId}.jsonl`)
    if (existsSync(f)) { const sub = parse(f); t.childCount = sub.tools.length; line += `  ↳ 子檔有 ${sub.tools.length} 個工作項目` }
  }
  console.log(line)
}

console.log('\n----- 對話重建(前 6 則)-----')
for (const m of convo.slice(0, 6)) {
  console.log(`  ${m.role === 'user' ? '你 ' : 'AI '}| ${m.text.replace(/\n/g, ' ').slice(0, 90)}`)
}

const subs = tools.filter((t) => t.kind === 'subagent')
console.log(`\n----- 統計 -----`)
console.log(`  subagent 數:${subs.length}(有連到子檔:${subs.filter((s) => s.agentId).length})`)
console.log(`  skill 數:${tools.filter((t) => t.kind === 'skill').length}`)
console.log(`  MCP 呼叫數:${tools.filter((t) => t.kind === 'mcp').length}`)
