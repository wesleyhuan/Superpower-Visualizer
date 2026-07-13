import type { PendingApproval } from '../store'

export function ApprovalQueue({
  pending, onDecide,
}: { pending: PendingApproval[]; onDecide: (toolUseId: string, allow: boolean) => void }) {
  if (pending.length === 0) return null
  return (
    <div>
      {pending.map((p) => (
        <div key={p.toolUseId} data-tooluseid={p.toolUseId}>
          <span>{p.name}: {JSON.stringify(p.input)}</span>
          <button onClick={() => onDecide(p.toolUseId, true)}>核准</button>
          <button onClick={() => onDecide(p.toolUseId, false)}>拒絕</button>
        </div>
      ))}
    </div>
  )
}
