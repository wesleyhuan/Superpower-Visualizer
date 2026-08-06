import { useState, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SessionInfo, Mode, SourceSystem } from '../wireTypes'

// 下拉內共用小圖示,與觸發鈕的 chevron 同一視覺系(currentColor / stroke 2.4)。
function Chevron({ dir = 'right' }: { dir?: 'right' | 'down' | 'left' }) {
  const rot = dir === 'down' ? 90 : dir === 'left' ? 180 : 0
  return (
    <svg className="si-icon" style={{ transform: `rotate(${rot}deg)` }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
  )
}
function Plus() {
  return (
    <svg className="si-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  )
}

function relTime(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小時前`
  return `${Math.floor(h / 24)} 天前`
}

// 專案顯示名。有真實路徑(cwd)就取最後一段資料夾名——跨 OS / 磁碟都正確;
// 抽不到 cwd 才反解 Claude Code 的 slug(C--Users-<user>-Desktop-proj → proj/chess):
// 去磁碟(C--)、根(-)、家目錄(Users/home 的 <user>[/Desktop])前綴,再把 - 還原成 /。
export function shortProject(p: string, cwd?: string): string {
  if (cwd) return cwd.split(/[\\/]/).filter(Boolean).pop() || p
  return p
    .replace(/^[A-Za-z]--/, '')
    .replace(/^-+/, '')
    .replace(/^(Users|home)-[^-]+-(Desktop-)?/, '')
    .replace(/-/g, '/')
}

// 每筆 session 的標題 / 副標,依系統不同。
function titleOf(s: SessionInfo): string {
  if (s.system === 'antigravity') return s.identity || s.file.split(/[\\/]/).pop() || s.file
  // Claude:優先用該對話第一句;抽不到才回退專案名。
  return s.title || shortProject(s.project, s.cwd)
}
function metaOf(s: SessionInfo): string {
  const t = relTime(s.mtime)
  if (s.system === 'antigravity') return `${t} · ${s.steps} 步`
  // 專案名降為副標;但標題已回退成專案名時就不重複顯示。
  const slug = shortProject(s.project, s.cwd)
  const prefix = s.title && s.title !== slug ? `${slug} · ` : ''
  return prefix + t + (s.subagents > 0 ? ` · ${s.subagents} subagent` : '')
}

// 依後端 trivial 旗標把清單拆成正常組與瑣碎組(僅 Claude 有 trivial;其餘皆入 normal)。
export function splitSessions(list: SessionInfo[]): { normal: SessionInfo[]; trivial: SessionInfo[] } {
  const normal: SessionInfo[] = []
  const trivial: SessionInfo[] = []
  for (const s of list) {
    if (s.system === 'claude' && s.trivial) trivial.push(s)
    else normal.push(s)
  }
  return { normal, trivial }
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
  const [showTrivial, setShowTrivial] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setView('root'); return } // 每次開回到系統選擇
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) } // 鍵盤可及性:Esc 收回
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pickSystem = (system: SourceSystem) => {
    setView(system)
    setLoading(true)
    setSessions([])
    setShowTrivial(false)
    void loadSessions(system).then((list) => { setSessions(list); setLoading(false) })
  }

  const label = mode === 'observe' ? '觀察中(唯讀)' : '操控模式'

  // 方向鍵在項目間移動焦點(Home/End 到首末),補足下拉的鍵盤導覽。
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.source-item'))
    if (!items.length) return
    const cur = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (cur + 1) % items.length
      : (cur - 1 + items.length) % items.length
    items[next]?.focus()
  }

  // tooltip 帶完整標題 + 真實路徑,標題被 ellipsis 截斷時仍讀得到全文。
  const renderItem = (s: SessionInfo) => (
    <button key={s.file} className="source-item" onClick={() => { onObserve(s.system, s.file); setOpen(false) }} title={titleOf(s) + (s.cwd ? `\n${s.cwd}` : '')}>
      <span className="si-title">{titleOf(s)}</span>
      <span className="si-meta">{metaOf(s)}</span>
    </button>
  )

  return (
    <div className="source-picker" ref={ref}>
      <button className={`pill source-toggle ${mode}`} onClick={() => setOpen((o) => !o)} aria-label="切換來源" aria-expanded={open}>
        <span className={`dot ${mode === 'observe' ? 'observe' : 'live'}`} />
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && view === 'root' && (
        <div className="source-menu" aria-label="來源選單" onKeyDown={onMenuKey}>
          <button className="source-item new-agent" onClick={() => { onNewAgent(); setOpen(false) }}>
            <span className="si-plus"><Plus /></span>
            <span>新 Agent(操控)</span>
          </button>
          <div className="source-menu-label">觀察其他 session(唯讀)</div>
          <button className="source-item drill" onClick={() => pickSystem('claude')}>
            <span className="si-text">
              <span className="si-title">觀察 Claude session</span>
              <span className="si-meta">~/.claude/projects</span>
            </span>
            <Chevron />
          </button>
          <button className="source-item drill" onClick={() => pickSystem('antigravity')}>
            <span className="si-text">
              <span className="si-title">觀察 Antigravity 對話</span>
              <span className="si-meta">~/.gemini/antigravity</span>
            </span>
            <Chevron />
          </button>
        </div>
      )}

      {open && view !== 'root' && (
        <div className="source-menu" aria-label="來源選單" onKeyDown={onMenuKey}>
          <button className="source-item back" onClick={() => setView('root')}>
            <span className="si-plus"><Chevron dir="left" /></span>
            <span>{view === 'antigravity' ? 'Antigravity 對話' : 'Claude session'}</span>
          </button>
          {loading
            ? <div className="source-empty">載入中…</div>
            : sessions.length === 0
              ? <div className="source-empty">找不到可觀察的 session</div>
              : (() => {
                  const { normal, trivial } = splitSessions(sessions)
                  return (
                    <>
                      {normal.map(renderItem)}
                      {trivial.length > 0 && (
                        <>
                          <button className="source-item trivial-toggle" onClick={() => setShowTrivial((v) => !v)}>
                            <span className="si-plus"><Chevron dir={showTrivial ? 'down' : 'right'} /></span>
                            <span>{showTrivial ? '收起' : '顯示'}瑣碎 session ({trivial.length})</span>
                          </button>
                          {showTrivial && trivial.map(renderItem)}
                        </>
                      )}
                    </>
                  )
                })()}
        </div>
      )}
    </div>
  )
}
