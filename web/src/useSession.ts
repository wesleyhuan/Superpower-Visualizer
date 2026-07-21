import { useEffect, useRef, useState, useCallback } from 'react'
import { applyPacket, resolvePending, initialState, type SessionState } from './store'
import type { Packet, ControlCommand, SessionInfo, SourceSystem, AnalysisTrace, AnalysisResult, DirListing } from './wireTypes'

export interface SessionDeps { wsUrl?: string; WebSocketImpl?: typeof WebSocket; fetchImpl?: typeof fetch }

export function useSession(deps: SessionDeps = {}) {
  const WS = deps.WebSocketImpl ?? WebSocket
  const doFetch = deps.fetchImpl ?? fetch
  const wsUrl = deps.wsUrl ?? `ws://${location.hostname}:3001`

  const [state, setState] = useState<SessionState>(initialState())
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      const ws = new WS(wsUrl)
      wsRef.current = ws
      ws.onopen = () => { console.log('[ws] open'); setConnected(true) }
      ws.onmessage = (e: MessageEvent) => {
        const packet = JSON.parse(e.data) as Packet
        setState((s) => applyPacket(s, packet))
      }
      ws.onclose = () => {
        console.log('[ws] close; reconnecting')
        setConnected(false)
        if (!closedRef.current) timer = setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closedRef.current = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [wsUrl])

  const post = useCallback((path: string, body: unknown) => {
    void doFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [doFetch])

  const control = useCallback((cmd: ControlCommand) => post('/control', cmd), [post])

  const pause = useCallback(() => control({ type: 'pause' }), [control])
  const followup = useCallback((text: string) => control({ type: 'followup', text }), [control])
  const start = useCallback((prompt: string) => post('/start', { prompt }), [post])
  const approve = useCallback((toolUseId: string, allow: boolean) => {
    control({ type: 'approve', toolUseId, allow })
    setState((s) => resolvePending(s, toolUseId)) // 樂觀更新
  }, [control])

  // Route A/B 切換。observe 帶 system(claude 讀 .jsonl、antigravity 讀 .db)。
  const observe = useCallback((system: SourceSystem, file: string) => post('/observe', { system, file }), [post])
  const newAgent = useCallback((cwd?: string) => post('/new-agent', cwd ? { cwd } : {}), [post])
  const loadSessions = useCallback(async (system: SourceSystem): Promise<SessionInfo[]> => {
    try {
      const res = await doFetch(`/sessions?system=${system}`)
      const data = await res.json()
      return data.sessions ?? []
    } catch (err) {
      console.error('[sessions] 載入失敗', err)
      return []
    }
  }, [doFetch])

  // 合理性分析:POST /analyze,回傳結構化結果;失敗回 warn fallback(不拋出)。
  const analyze = useCallback(async (trace: AnalysisTrace): Promise<AnalysisResult> => {
    try {
      const res = await doFetch('/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trace }),
      })
      return await res.json()
    } catch (err) {
      console.error('[analyze] 請求失敗', err)
      return { verdict: 'warn', summary: `分析失敗:${String(err)}`, findings: [] }
    }
  }, [doFetch])

  const loadDirs = useCallback(async (path: string): Promise<DirListing> => {
    const res = await doFetch(`/dirs?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error('無法讀取此目錄')
    return res.json()
  }, [doFetch])

  const makeDir = useCallback(async (parent: string, name: string): Promise<string> => {
    const res = await doFetch('/mkdir', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? '建立資料夾失敗')
    return data.path
  }, [doFetch])

  return { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions, analyze, loadDirs, makeDir }
}
