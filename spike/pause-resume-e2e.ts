// 驗證 pause 後重建 controller:暫停 → 再 start 新任務應能正常跑,不再 Operation aborted。
import { WebSocket } from 'ws'
const HTTP = 'http://localhost:3001', WS_URL = 'ws://localhost:3001'
const t0 = Date.now(), ms = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`
const post = (p: string, b: unknown) =>
  fetch(HTTP + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => console.log(`[prz] ${ms()} POST ${p} →`, r.status))

let phase: 'task1' | 'paused' | 'task2' = 'task1'
let task2Events = 0
let task2Error = false
let sawWriteAwait = false

const ws = new WebSocket(WS_URL)
ws.on('open', async () => {
  console.log(`[prz] ${ms()} open`)
  await post('/start', { prompt: '請用 Read 逐一讀取 src/ 底下每個 .ts 檔並各用一句話說明。' })
})
ws.on('message', (data) => {
  const p = JSON.parse(data.toString())
  if (p.type === 'snapshot') return
  const ev = p.event
  if (phase === 'task2') {
    task2Events++
    if (ev.kind === 'session:error') { task2Error = true; console.log(`[prz] ${ms()} task2 session:error!`, ev.message) }
    else console.log(`[prz] ${ms()} task2 ${ev.kind}`, ev.kind === 'tree:node' ? ev.node.label : ev.kind === 'await:tool' ? ev.name : '')
    if (ev.kind === 'await:tool') {
      if (ev.name === 'Write') sawWriteAwait = true
      void post('/control', { type: 'approve', toolUseId: ev.toolUseId, allow: true })
    }
  }
})

// 第一個任務跑 6 秒 → 暫停 → 等 5 秒讓 task1 尾巴散去 → 啟動第二個任務(Write,觸發核准)
setTimeout(async () => { phase = 'paused'; console.log(`[prz] ${ms()} >>> pause`); await post('/control', { type: 'pause' }) }, 6000)
setTimeout(async () => {
  phase = 'task2'; console.log(`[prz] ${ms()} >>> start task2(暫停後)`)
  await post('/start', { prompt: '請直接用 Write 工具在專案根目錄建立 resume-ok.txt,內容就是「resume works」。除了 Write 不要用其他工具。' })
}, 11000)

setTimeout(() => {
  console.log(`\n[prz] SUMMARY  task2事件=${task2Events}  Write核准觸發=${sawWriteAwait}  session:error=${task2Error}`)
  console.log(`[prz] 判定: ${sawWriteAwait && !task2Error ? '✅ 暫停後新 session 能執行新任務(Write 閘門觸發)'
    : task2Error ? '❌ 仍 session:error' : '⚠️ 未見 Write 核准(以檔案是否建立為最終依據)'}`)
  ws.close(); process.exit(0)
}, 26000)
