import { useState, useRef, useEffect } from 'react'
import type { SessionInfo, Mode, SourceSystem } from '../wireTypes'

function relTime(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小時前`
  return `${Math.floor(h / 24)} 天前`
}

// slug 形如 C--Users-wesle-Desktop-HW-chess → HW/chess
function shortProject(p: string): string {
  return p.replace(/^C--Users-[^-]+-Desktop-/, '').replace(/^C--Users-[^-]+-/, '').replace(/-/g, '/')
}

// 每筆 session 的標題 / 副標,依系統不同。
function titleOf(s: SessionInfo): string {
  if (s.system === 'antigravity') return s.identity || s.file.split(/[\\/]/).pop() || s.file
  return s.cwd ? shortProject(s.project) : s.project
}
function metaOf(s: SessionInfo): string {
  const t = relTime(s.mtime)
  if (s.system === 'antigravity') return `${t} · ${s.steps} 步`
  return t + (s.subagents > 0 ? ` · ${s.subagents} subagent` : '')
}

interface Props {
  mode: Mode
  onObserve: (system: SourceSystem, file: string) => void
  onNewAgent: () => void
  loadSessions: (system: SourceSystem) => Promise<SessionInfo[]>
}

// 兩層選單:先選系統(操控 / 觀察 Claude / 觀察 Antigravity),再選該系統的 session。
export function SourcePicker({ mode, onObserve, onNewAgent, loadSessions }: Props) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'root' | SourceSystem>('root')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setView('root'); return } // 每次開回到系統選擇
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pickSystem = (system: SourceSystem) => {
    setView(system)
    setLoading(true)
    setSessions([])
    void loadSessions(system).then((list) => { setSessions(list); setLoading(false) })
  }

  const label = mode === 'observe' ? '觀察中(唯讀)' : '操控模式'

  return (
    <div className="source-picker" ref={ref}>
      <button className={`pill source-toggle ${mode}`} onClick={() => setOpen((o) => !o)} aria-label="切換來源" aria-expanded={open}>
        <span className={`dot ${mode === 'observe' ? 'observe' : 'live'}`} />
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && view === 'root' && (
        <div className="source-menu" role="menu">
          <button className="source-item new-agent" onClick={() => { onNewAgent(); setOpen(false) }}>
            <span className="si-plus">＋</span>
            <span>新 Agent(操控)</span>
          </button>
          <div className="source-menu-label">觀察其他 session(唯讀)</div>
          <button className="source-item" onClick={() => pickSystem('claude')}>
            <span className="si-title">觀察 Claude session ▸</span>
            <span className="si-meta">~/.claude/projects</span>
          </button>
          <button className="source-item" onClick={() => pickSystem('antigravity')}>
            <span className="si-title">觀察 Antigravity 對話 ▸</span>
            <span className="si-meta">~/.gemini/antigravity</span>
          </button>
        </div>
      )}

      {open && view !== 'root' && (
        <div className="source-menu" role="menu">
          <button className="source-item back" onClick={() => setView('root')}>
            <span className="si-plus">◂</span>
            <span>{view === 'antigravity' ? 'Antigravity 對話' : 'Claude session'}</span>
          </button>
          {loading
            ? <div className="source-empty">載入中…</div>
            : sessions.length === 0
              ? <div className="source-empty">找不到可觀察的 session</div>
              : sessions.map((s) => (
                <button key={s.file} className="source-item" onClick={() => { onObserve(s.system, s.file); setOpen(false) }} title={s.cwd || s.file}>
                  <span className="si-title">{titleOf(s)}</span>
                  <span className="si-meta">{metaOf(s)}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  )
}
