import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { SnapshotStore } from './snapshot'
import { SessionManager } from './sessionManager'
import { SourceController } from './sourceController'
import { ReActAssembler } from './reactAssembler'
import { makeObserveSource, workspaceFor, listObservableSessions } from './sourceSystems'
import type { SourceSystem } from './sourceSystems'
import { translate } from './translator'
import { realRunQuery, resolveWorkspace } from './agentAdapter'
import { runAnalysis } from './analyze'
import { realAnalyzeQuery } from './analyzeQuery'
import type { ControlCommand } from './types'

type Packet = { type: 'event'; seq: number; event: unknown }

// 純接線邏輯,方便單元測試
export function wireEvents(
  mgr: { onMessage: (cb: (m: any) => void) => void; onAwaitTool: (cb: (a: any) => void) => void },
  store: SnapshotStore,
  broadcast: (p: Packet) => void,
  assembler: ReActAssembler,
) {
  const emit = (evs: ReturnType<ReActAssembler['process']>) => {
    for (const ev of evs) {
      const { seq, event } = store.apply(ev)
      broadcast({ type: 'event', seq, event })
    }
  }
  mgr.onMessage((msg) => {
    if (msg?.type === 'session_error') {
      emit(assembler.flushAll())
      const { seq, event } = store.apply({ kind: 'session:error', message: msg.error })
      broadcast({ type: 'event', seq, event })
      return
    }
    // 回合結束:把最後還沒配到工具的敘述 flush 成對話總結。
    if (msg?.type === 'result') {
      emit(assembler.flushAll())
      return
    }
    emit(assembler.process(translate(msg)))
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

  const broadcast = (packet: unknown) => {
    const data = JSON.stringify(packet)
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data)
  }
  // ReAct 組裝器:Route A/B 共用,把敘述配對成工具的 reason。切換來源時由 controller reset。
  const assembler = new ReActAssembler()
  // 進 observe 前叫停 control agent(pause 對「沒在跑」也安全:清空 pending、重建 controller)。
  const controller = new SourceController(store, broadcast, resolveWorkspace, () => mgr.pause(), assembler)
  wireEvents(mgr, store, broadcast, assembler)

  // 把使用者訊息也灌進事件管線,讓對話面板即時顯示、且能進 snapshot(斷線重連還原)。
  // 走 assembler:人類訊息會先把 agent 上一輪還沒配到工具的敘述 flush 成總結,再放使用者訊息。
  const emitUserMessage = (text: string) => {
    const t = text.trim()
    if (!t) return
    for (const ev of assembler.process([{ kind: 'message', role: 'user', text: t }])) {
      const { seq, event } = store.apply(ev)
      broadcast({ type: 'event', seq, event })
    }
  }

  // 依系統把 query/body 的 system 正規化(預設 claude)。
  const asSystem = (v: unknown): SourceSystem => (v === 'antigravity' ? 'antigravity' : 'claude')

  // 列出可觀察的外部 session(給前端「來源」下拉用)。system=claude|antigravity。
  app.get('/sessions', (req, res) => {
    res.json({ sessions: listObservableSessions(asSystem(req.query.system)) })
  })

  // 切到 Route A(唯讀觀察某個外部 session)。system 決定來源型別(.jsonl / .db)。
  app.post('/observe', (req, res) => {
    const file = String(req.body?.file ?? '')
    if (!file) return res.status(400).json({ ok: false, error: 'missing file' })
    const system = asSystem(req.body?.system)
    controller.observe(file, (f, emit) => makeObserveSource(system, f, emit), (f) => workspaceFor(system, f))
    res.json({ ok: true })
  })

  // 回到 Route B control 空白狀態(準備開新 agent)。
  app.post('/new-agent', (_req, res) => {
    controller.toControl()
    res.json({ ok: true })
  })

  app.post('/start', (req, res) => {
    if (controller.isObserving()) controller.toControl() // 從觀察切回操控,清空畫面
    const prompt = String(req.body?.prompt ?? '')
    emitUserMessage(prompt)
    mgr.start(prompt)
    res.json({ ok: true })
  })

  app.post('/control', (req, res) => {
    // observe 模式唯讀:控制指令一律 no-op,避免前端誤操作。
    if (controller.isObserving()) return res.json({ ok: true, readOnly: true })
    const cmd = req.body as ControlCommand
    console.log('[server] control', cmd)
    if (cmd.type === 'pause') mgr.pause()
    else if (cmd.type === 'approve') mgr.approveTool(cmd.toolUseId, cmd.allow)
    else if (cmd.type === 'followup') { emitUserMessage(cmd.text); mgr.sendFollowup(cmd.text) }
    res.json({ ok: true })
  })

  // 合理性分析:把某個 agent 的 ReAct 軌跡交給另一個 Claude 審查(無狀態,不進 store/WS/SessionManager)。
  app.post('/analyze', async (req, res) => {
    const trace = req.body?.trace
    if (!trace || !Array.isArray(trace.steps)) {
      console.error('[server] /analyze 缺少 trace 或 steps')
      return res.status(400).json({ error: 'missing trace' })
    }
    console.log('[server] /analyze', trace.title, trace.steps.length, '步')
    try {
      const result = await runAnalysis(trace, realAnalyzeQuery)
      res.json(result)
    } catch (err) {
      console.error('[server] /analyze 失敗:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  const server = app.listen(3001, () => console.log('[server] http on :3001'))
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify(controller.snapshot()))
    ws.on('close', () => clients.delete(ws))
  })
  return { app, server, wss }
}

if (require.main === module) createServer()
