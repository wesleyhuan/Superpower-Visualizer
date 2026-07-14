import type { ConversationEntry } from '../wireTypes'

const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)

export function Conversation({ messages }: { messages: ConversationEntry[] }) {
  if (messages.length === 0) {
    return <div className="empty">尚未開始對話 — 在下方輸入任務啟動 agent。</div>
  }
  return (
    <div className="convo">
      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.role}`} data-role={m.role}>
          <span className="who">{m.role === 'user' ? '你' : <BoltIcon />}</span>
          <div className="mbody">
            <div className="name">{m.role === 'user' ? '你' : 'Agent'}</div>
            {m.role === 'user'
              ? <div className="bubble">{m.text}</div>
              : <div className="text">{m.text}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
