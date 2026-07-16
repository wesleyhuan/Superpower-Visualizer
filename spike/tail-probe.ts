// 用真實逐字稿驗證 TranscriptSource 的 backfill 產出。
import { TranscriptSource } from '../src/transcriptSource'

const file = process.argv[2]
if (!file) { console.error('need a .jsonl'); process.exit(1) }

const c: Record<string, number> = { node: 0, status: 0, msg: 0, log: 0, sub: 0, skill: 0, mcp: 0 }
const src = new TranscriptSource(file, (evs) => {
  for (const e of evs) {
    if (e.kind === 'tree:node') {
      c.node++
      if (e.node.type === 'subagent') c.sub++
      if (e.node.type === 'skill') c.skill++
      if (/^mcp__/.test(e.node.label)) c.mcp++
    }
    if (e.kind === 'tree:status') c.status++
    if (e.kind === 'message') c.msg++
    if (e.kind === 'log') c.log++
  }
}, 999999)
src.start()
src.stop()
console.log(JSON.stringify(c, null, 2))
