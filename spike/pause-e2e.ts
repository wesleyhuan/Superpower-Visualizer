// 暫停 E2E:驗證 pause() → abort 後,SDK stream 的結束方式與 session:error 時機。
// 起一個會連續 Read 多檔的長任務(唯讀自動放行、持續串流),跑到一半送 pause,
// 觀察其後是否還收到 session:error、以及事件多久後停止。
import { WebSocket } from 'ws'

const HTTP = 'http://localhost:3001'
const WS_URL = 'ws://localhost:3001'
const t0 = Date.now()
const ms = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`

async function post(path: string, body: unknown) {
  const res = await fetch(HTTP + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  console.log(`[pause-e2e] ${ms()} POST ${path} →`, res.status)
}

let lastEventAt = 0
let paused = false
let sawSessionError = false
let eventsAfterPause = 0

let pauseScheduled = false
function schedulePauseOncstreaming() {
  if (pauseScheduled) return
  pauseScheduled = true
  // 收到第一個真實事件後,再等 2 秒(確保 stream 正在活躍吐事件)才送 pause。
  setTimeout(() => { console.log(`[pause-e2e] ${ms()} >>> 送出 pause(串流進行中)`); paused = true; void post('/control', { type: 'pause' }) }, 2000)
}

const ws = new WebSocket(WS_URL)
ws.on('open', async () => {
  console.log(`[pause-e2e] ${ms()} ws open`)
  await post('/start', {
    prompt: '請逐一用 Read 工具讀取 src/ 與 web/src/ 底下的每一個 .ts / .tsx 檔案,每讀一個就用一句話說明它的用途。請一個一個慢慢讀完全部,不要略過。',
  })
})

ws.on('message', (data) => {
  const packet = JSON.parse(data.toString())
  lastEventAt = Date.now()
  if (packet.type === 'snapshot') { console.log(`[pause-e2e] ${ms()} snapshot`); return }
  const ev = packet.event
  schedulePauseOncstreaming() // 第一個事件觸發:排定 2 秒後暫停
  if (paused) eventsAfterPause++
  if (ev.kind === 'session:error') { sawSessionError = true; console.log(`[pause-e2e] ${ms()} *** session:error ***`, ev.message) }
  else console.log(`[pause-e2e] ${ms()} seq=${packet.seq} ${ev.kind}`,
    ev.kind === 'tree:node' ? ev.node.label : ev.kind === 'tree:status' ? `${ev.id}=${ev.status}` : '')
})

// 暫停後再觀察 12 秒收尾。
setTimeout(() => {
  const quietFor = ((Date.now() - lastEventAt) / 1000).toFixed(1)
  console.log(`\n[pause-e2e] SUMMARY`)
  console.log(`  暫停後又收到事件數: ${eventsAfterPause}`)
  console.log(`  是否收到 session:error: ${sawSessionError}`)
  console.log(`  最後一個事件距今: ${quietFor}s(靜止代表 stream 已停)`)
  console.log(`  判定: ${sawSessionError ? '✅ abort → 丟錯 → session:error(前端會標記結束)'
    : eventsAfterPause === 0 ? '✅ abort → stream 安靜結束(無 session:error,事件已停)'
    : '⚠️ 暫停後仍持續冒事件,abort 未生效'}`)
  ws.close(); process.exit(0)
}, 18000)
