import { TranscriptSource } from '../src/transcriptSource'
import { ReActAssembler } from '../src/reactAssembler'
const file = process.argv[2]
const a = new ReActAssembler()
let nodes=0, withReason=0, msgs=0; const samples:string[]=[]
const src = new TranscriptSource(file, (evs) => {
  for (const e of a.process(evs)) {
    if (e.kind==='tree:node'){ nodes++; if(e.node.reason){ withReason++; if(samples.length<4) samples.push(`  🔧 ${e.node.label.slice(0,40)}\n     💭 ${e.node.reason.replace(/\n/g,' ').slice(0,80)}`) } }
    if (e.kind==='message') msgs++
  }
}, 999999)
src.start(); for(const e of a.flushAll()){ if(e.kind==='message') msgs++ }; src.stop()
console.log(`節點 ${nodes} · 有 reason ${withReason} (${(withReason/nodes*100).toFixed(0)}%) · 對話訊息 ${msgs}`)
console.log('\n樣本:\n'+samples.join('\n\n'))
