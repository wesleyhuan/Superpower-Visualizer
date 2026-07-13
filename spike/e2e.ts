// E2E:模擬前端,對「正在跑的後端 :3001」做完整閉環驗證。
// 連 WS 收事件 → POST /start → 遇 await:tool 自動核准 → 觀察樹/日誌/session 結束。
import { WebSocket } from 'ws'

const HTTP = 'http://localhost:3001'
const WS_URL = 'ws://localhost:3001'

async function post(path: string, body: unknown) {
  const res = await fetch(HTTP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  console.log(`[e2e] POST ${path} →`, res.status)
}

const seen = { nodes: 0, awaits: 0, approvedNodeDone: false, ended: false }

const ws = new WebSocket(WS_URL)
ws.on('open', async () => {
  console.log('[e2e] ws open')
  // 觸發需權限的工具:寫一個檔案。
  await post('/start', {
    prompt: '請用 Write 工具在專案根目錄建立一個檔案 e2e-hello.txt,內容為「hello from e2e」。完成後回報。',
  })
})

ws.on('message', (data) => {
  const packet = JSON.parse(data.toString())
  if (packet.type === 'snapshot') {
    console.log('[e2e] snapshot seq', packet.seq, 'nodes', packet.nodes.length)
    return
  }
  const ev = packet.event
  console.log(`[e2e] event seq=${packet.seq} kind=${ev.kind}`,
    ev.kind === 'tree:node' ? `${ev.node.type}:${ev.node.label}` :
    ev.kind === 'tree:status' ? `${ev.id}=${ev.status}` :
    ev.kind === 'await:tool' ? `${ev.name} (${ev.toolUseId})` :
    ev.kind === 'session:error' ? ev.message : '')

  if (ev.kind === 'tree:node') seen.nodes++
  if (ev.kind === 'await:tool') {
    seen.awaits++
    console.log('[e2e] → 自動核准', ev.toolUseId)
    void post('/control', { type: 'approve', toolUseId: ev.toolUseId, allow: true })
  }
  if (ev.kind === 'session:error') seen.ended = true
})

// 25 秒後總結收工(單一寫檔任務應該早就結束)。
setTimeout(() => {
  console.log('\n[e2e] SUMMARY', JSON.stringify(seen))
  console.log('[e2e] 判定:', seen.nodes > 0 && seen.awaits > 0 ? '✅ 閉環成立(有節點 + 核准觸發)' : '⚠️ 未達預期')
  ws.close()
  process.exit(0)
}, 25000)
