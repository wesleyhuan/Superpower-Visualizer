import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSession, type SessionDeps } from './useSession'
import { buildAgentBlocks, flattenAgents } from './buildAgentBlocks'
import { AgentList } from './components/AgentList'
import { AgentModal } from './components/AgentModal'
import { Conversation } from './components/Conversation'
import { ApprovalModal } from './components/ApprovalModal'
import { SourcePicker } from './components/SourcePicker'
import type { LogEntry } from './wireTypes'

type Theme = 'light' | 'dark'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return [theme, toggle]
}

// 每個節點的工具輸出:把該 nodeId 的 log 內容合併,供區塊內折疊顯示(修日誌洗版)。
function outputsByNode(logs: LogEntry[]): Record<string, string> {
  const out: Record<string, string[]> = {}
  for (const l of logs) {
    if (!l.nodeId) continue
    ;(out[l.nodeId] ??= []).push(l.text)
  }
  const joined: Record<string, string> = {}
  for (const [id, texts] of Object.entries(out)) joined[id] = texts.join('\n')
  return joined
}

const SunPath = 'M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
const MoonPath = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'

export function App({ deps }: { deps?: SessionDeps } = {}) {
  const { state, connected, pause, approve, followup, start, observe, newAgent, loadSessions } = useSession(deps)
  const [theme, toggleTheme] = useTheme()
  const [draft, setDraft] = useState('')
  const isObserving = state.mode === 'observe'

  const { main } = useMemo(() => buildAgentBlocks(state), [state.nodes, state.order])
  const outputs = useMemo(() => outputsByNode(state.logs), [state.logs])
  const mainTitle = state.messages.find((m) => m.role === 'user')?.text ?? '主 Agent'
  const entries = useMemo(() => flattenAgents(main, mainTitle), [main, mainTitle])
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const hasStarted = state.order.length > 0 || state.messages.some((m) => m.role === 'user')

  const send = () => {
    if (isObserving) return // 觀察模式唯讀
    const text = draft.trim()
    if (!text) return
    if (!hasStarted || state.sessionEnded) start(text)
    else followup(text)
    setDraft('')
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }

  const nodeCount = state.order.length
  const subCount = main.children.length

  return (
    <div className="app">
      {/* TOP BAR */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
          </div>
          <div><h1>Superpower Visualizer</h1><div className="sub">Agent 即時監控</div></div>
        </div>
        <div className="spacer" />
        <SourcePicker mode={state.mode} onObserve={observe} onNewAgent={newAgent} loadSessions={loadSessions} />
        {state.pending.length > 0 && (
          <span className="badge-await"><span className="bdot" /> {state.pending.length} 待核准</span>
        )}
        <span className="pill"><span className={`dot ${connected ? 'live' : 'off'}`} /> {connected ? '已連線' : '連線中…'}</span>
        {state.workspace && (
          <span className="workspace" title={state.workspace}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            {state.workspace}
          </span>
        )}
        <button className="icon-btn" onClick={toggleTheme} aria-label="切換深淺主題" title="切換深淺主題">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={theme === 'dark' ? SunPath : MoonPath} /></svg>
        </button>
      </header>

      {/* MAIN */}
      <main className="main">
        <section className="panel">
          <div className="panel-head">
            <h2>Agents</h2>
            <span className="count">{nodeCount} 個節點{subCount > 0 ? ` · ${subCount} 個 subagent` : ''}</span>
          </div>
          <div className="panel-body">
            {nodeCount === 0
              ? <div className="empty">尚無活動 — 啟動 agent 後,它的工作與 subagent 會顯示在這裡。</div>
              : <AgentList entries={entries} onOpen={setOpenIndex} />}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>對話</h2>
            <span className="count">與 agent 的即時對話</span>
          </div>
          <div className="panel-body">
            {state.sessionEnded && (
              <div className="ended-banner" style={{ marginBottom: 12 }}>
                Session 已結束{state.errorMessage ? `:${state.errorMessage}` : ''}
              </div>
            )}
            <Conversation messages={state.messages} />
          </div>
          <div className="composer">
            {!isObserving && (
              <button className="stop" onClick={pause} disabled={state.sessionEnded} title="暫停 agent" aria-label="暫停 agent">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              </button>
            )}
            <div className="field">
              <span className="prompt-caret">&gt;</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                disabled={isObserving}
                placeholder={
                  isObserving ? '觀察中(唯讀)—切到「新 Agent」才能操控'
                    : hasStarted && !state.sessionEnded ? '派新任務給 agent…'
                    : '輸入初始任務啟動 agent…'
                }
              />
            </div>
            <button className="btn btn-primary" onClick={send} disabled={isObserving || draft.trim() === ''}>
              送出
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </section>
      </main>

      {openIndex !== null && openIndex < entries.length && (
        <AgentModal
          entries={entries}
          index={openIndex}
          outputByNode={outputs}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
      <ApprovalModal pending={state.pending} onDecide={approve} />
    </div>
  )
}
