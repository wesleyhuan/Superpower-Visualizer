import { useEffect, useRef, useState, useCallback } from 'react'
import { applyPacket, resolvePending, initialState, type SessionState } from './store'
import { normalizeAnalysisResult } from './normalizeAnalysis'
import type { Packet, ControlCommand, SessionInfo, SourceSystem, AnalysisTrace, AnalysisResult, DirListing } from './wireTypes'

// 每個 POST 路徑失敗時給使用者看的動作名稱。
const ACTION_LABEL: Record<string, string> = {
  '/start': '啟動 agent',
  '/control': '送出指令',
  '/observe': '切換觀察來源',
  '/new-agent': '開新 agent',
}

// 伺服器推來的訊息至少要是 { type: 'snapshot' | 'event' };其他形狀一律丟掉,不讓 store 吃到壞資料。
function parsePacket(data: unknown): Packet | null {
  if (typeof data !== 'string') return null
  let raw: any
  try {
    raw = JSON.parse(data)
  } catch (err) {
    console.error('[ws] 收到無法解析的訊息,已忽略', err)
    return null
  }
  if (raw?.type === 'snapshot' && Array.isArray(raw.nodes) && Array.isArray(raw.logs)) return raw as Packet
  if (raw?.type === 'event' && Number.isFinite(raw.seq) && typeof raw.event?.kind === 'string') return raw as Packet
  console.error('[ws] 收到格式不符的訊息,已忽略', raw)
  return null
}

export interface SessionDeps { wsUrl?: string; WebSocketImpl?: typeof WebSocket; fetchImpl?: typeof fetch }

export function useSession(deps: SessionDeps = {}) {
  const WS = deps.WebSocketImpl ?? WebSocket
  const doFetch = deps.fetchImpl ?? fetch
  const wsUrl = deps.wsUrl ?? `ws://${location.hostname}:3001`

  const [state, setState] = useState<SessionState>(initialState())
  const [connected, setConnected] = useState(false)
  // 最近一次請求失敗的提示(null = 沒事)。之前 POST 失敗完全沒反應,使用者以為按鈕壞了。
  const [notice, setNotice] = useState<string | null>(null)
  const dismissNotice = useCallback(() => setNotice(null), [])
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
        const packet = parsePacket(e.data)
        if (packet) setState((s) => applyPacket(s, packet))
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

  // 送出改狀態的請求(不等結果,呼叫端維持同步);失敗(網路斷、後端沒開、回 4xx/5xx)時設定 notice。
  const post = useCallback((path: string, body: unknown): void => {
    void (async () => {
      const label = ACTION_LABEL[path] ?? path
      try {
        const res = await doFetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error(`[post] ${path} 失敗`, err)
        const msg = err instanceof Error ? err.message : String(err)
        setNotice(`${label}失敗:${msg}。請確認後端(npm run dev)仍在執行。`)
      }
    })()
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
      if (!res.ok) throw new Error(`分析請求失敗:${res.status}`)
      return normalizeAnalysisResult(await res.json())
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

  return { state, connected, notice, dismissNotice, pause, approve, followup, start, observe, newAgent, loadSessions, analyze, loadDirs, makeDir }
}
