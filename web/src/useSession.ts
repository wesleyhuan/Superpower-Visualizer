import { useEffect, useRef, useState, useCallback } from 'react'
import { applyPacket, resolvePending, initialState, type SessionState } from './store'
import type { Packet, ControlCommand, SessionInfo } from './wireTypes'

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

  // Route A/B 切換
  const observe = useCallback((file: string) => post('/observe', { file }), [post])
  const newAgent = useCallback(() => post('/new-agent', {}), [post])
  const loadSessions = useCallback(async (): Promise<SessionInfo[]> => {
    try {
      const res = await doFetch('/sessions')
      const data = await res.json()
      return data.sessions ?? []
    } catch (err) {
      console.error('[sessions] 載入失敗', err)
      return []
    }
  }, [doFetch])

  return { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions }
}
