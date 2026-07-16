import { useState, useRef, useEffect } from 'react'
import type { SessionInfo, Mode } from '../wireTypes'

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

interface Props {
  mode: Mode
  onObserve: (file: string) => void
  onNewAgent: () => void
  loadSessions: () => Promise<SessionInfo[]>
}

export function SourcePicker({ mode, onObserve, onNewAgent, loadSessions }: Props) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void loadSessions().then(setSessions)
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, loadSessions])

  const label = mode === 'observe' ? '觀察中(唯讀)' : '操控模式'

  return (
    <div className="source-picker" ref={ref}>
      <button className={`pill source-toggle ${mode}`} onClick={() => setOpen((o) => !o)} aria-label="切換來源" aria-expanded={open}>
        <span className={`dot ${mode === 'observe' ? 'observe' : 'live'}`} />
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="source-menu" role="menu">
          <button className="source-item new-agent" onClick={() => { onNewAgent(); setOpen(false) }}>
            <span className="si-plus">＋</span>
            <span>新 Agent(操控)</span>
          </button>
          <div className="source-menu-label">觀察其他 session(唯讀)</div>
          {sessions.length === 0
            ? <div className="source-empty">找不到可觀察的 session</div>
            : sessions.map((s) => (
              <button key={s.file} className="source-item" onClick={() => { onObserve(s.file); setOpen(false) }} title={s.cwd || s.file}>
                <span className="si-title">{s.cwd ? shortProject(s.project) : s.project}</span>
                <span className="si-meta">{relTime(s.mtime)}{s.subagents > 0 ? ` · ${s.subagents} subagent` : ''}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
