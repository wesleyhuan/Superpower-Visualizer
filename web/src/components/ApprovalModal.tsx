import { useEffect } from 'react'
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

  // Esc = 拒絕(安全預設)
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDecide(current.toolUseId, false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, onDecide])

  if (!current) return null

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onDecide(current.toolUseId, false) }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="approval-title">
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
          <button className="btn btn-deny" onClick={() => onDecide(current.toolUseId, false)}><Cross />拒絕</button>
          <button className="btn btn-approve" onClick={() => onDecide(current.toolUseId, true)}><Check />核准</button>
        </div>
      </div>
    </div>
  )
}
