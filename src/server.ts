import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { SnapshotStore } from './snapshot'
import { SessionManager } from './sessionManager'
import { translate } from './translator'
import { realRunQuery } from './agentAdapter'
import type { ControlCommand } from './types'

type Packet = { type: 'event'; seq: number; event: unknown }

// 純接線邏輯,方便單元測試
export function wireEvents(
  mgr: { onMessage: (cb: (m: any) => void) => void; onAwaitTool: (cb: (a: any) => void) => void },
  store: SnapshotStore,
  broadcast: (p: Packet) => void,
) {
  mgr.onMessage((msg) => {
    if (msg?.type === 'session_error') {
      const { seq, event } = store.apply({ kind: 'session:error', message: msg.error })
      broadcast({ type: 'event', seq, event })
      return
    }
    for (const ev of translate(msg)) {
      const { seq, event } = store.apply(ev)
      broadcast({ type: 'event', seq, event })
    }
  })
  mgr.onAwaitTool((a) => {
    const { seq, event } = store.apply({ kind: 'await:tool', toolUseId: a.toolUseId, name: a.name, input: a.input })
    broadcast({ type: 'event', seq, event })
  })
}

export function createServer() {
  const app = express()
  app.use(express.json())
  const store = new SnapshotStore()
  const mgr = new SessionManager({ runQuery: realRunQuery })
  const clients = new Set<WebSocket>()

  wireEvents(mgr, store, (packet) => {
    const data = JSON.stringify(packet)
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data)
  })

  app.post('/start', (req, res) => {
    mgr.start(String(req.body?.prompt ?? ''))
    res.json({ ok: true })
  })

  app.post('/control', (req, res) => {
    const cmd = req.body as ControlCommand
    console.log('[server] control', cmd)
    if (cmd.type === 'pause') mgr.pause()
    else if (cmd.type === 'approve') mgr.approveTool(cmd.toolUseId, cmd.allow)
    else if (cmd.type === 'followup') mgr.sendFollowup(cmd.text)
    res.json({ ok: true })
  })

  const server = app.listen(3001, () => console.log('[server] http on :3001'))
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify({ type: 'snapshot', ...store.snapshot() }))
    ws.on('close', () => clients.delete(ws))
  })
  return { app, server, wss }
}

if (require.main === module) createServer()
