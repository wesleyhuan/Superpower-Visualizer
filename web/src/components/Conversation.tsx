import { useRef, useEffect } from 'react'
import type { ConversationEntry } from '../wireTypes'

const BoltIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)

export function Conversation({ messages }: { messages: ConversationEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // 是否黏在底部跟隨新訊息(預設是,含首次載入 / 觀察大量歷史)
  const hasMsgs = messages.length > 0

  // 監聽捲動:使用者往上翻離底部(>120px)就停止跟隨,回到底部再恢復。捲動容器是外層 .panel-body。
  useEffect(() => {
    const box = endRef.current?.closest('.panel-body') as HTMLElement | null
    if (!box) return
    const onScroll = () => { stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120 }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [hasMsgs])

  // 有新訊息時,若仍黏在底部就捲到最新,跟隨 agent 輸出。
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

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
      <div ref={endRef} aria-hidden="true" />
    </div>
  )
}
