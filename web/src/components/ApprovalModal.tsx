import { useEffect, useRef } from 'react'
import type { PendingApproval } from '../store'

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
)
const Cross = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
)

function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

export function ApprovalModal({ pending, onDecide }: { pending: PendingApproval[]; onDecide: (toolUseId: string, allow: boolean) => void }) {
  const current = pending[0]
  const modalRef = useRef<HTMLDivElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)

  // Esc = 拒絕(安全預設)
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDecide(current.toolUseId, false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, onDecide])

  // 開啟時把焦點移到「拒絕」鈕(安全預設),鍵盤使用者不必先 Tab 進來
  useEffect(() => { if (current) denyRef.current?.focus() }, [current?.toolUseId])

  // 簡易 focus trap:Tab 到邊界時繞回,焦點不逸出 modal
  const onTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const f = modalRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!f?.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  if (!current) return null

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onDecide(current.toolUseId, false) }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="approval-title" ref={modalRef} onKeyDown={onTab}>
        <div className="modal-head">
          <span className="ring" />
          <h3 id="approval-title">等待你核准</h3>
          <span className="whobadge">{pending.length > 1 ? `還有 ${pending.length - 1} 筆` : '主 AGENT'}</span>
        </div>
        <div className="modal-body">
          <div className="tool">即將執行 <b>{current.name}</b></div>
          <pre>{formatInput(current.input)}</pre>
        </div>
        <div className="modal-foot">
          <button className="btn btn-deny" onClick={() => onDecide(current.toolUseId, false)} ref={denyRef}><Cross />拒絕</button>
          <button className="btn btn-approve" onClick={() => onDecide(current.toolUseId, true)}><Check />核准</button>
        </div>
      </div>
    </div>
  )
}
