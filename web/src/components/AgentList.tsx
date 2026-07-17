import type { AgentEntry } from '../buildAgentBlocks'

const STATUS_LABEL: Record<string, string> = {
  running: '執行中', awaiting: '等待核准', done: '完成', error: '錯誤', failed: '失敗', interrupted: '已中止',
}

const BoltIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
)
const GoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
)

// 左側 agent 清單:每列一個 agent(main + 各 subagent),點列開彈窗。
export function AgentList({ entries, onOpen }: { entries: AgentEntry[]; onOpen: (index: number) => void }) {
  return (
    <div className="agent-list">
      {entries.map((e, i) => (
        <button key={e.key} className="arow" data-status={e.status} onClick={() => onOpen(i)}>
          <span className={`arow-avatar ${e.kind}`}>{e.kind === 'main' ? <BoltIcon /> : <UserIcon />}</span>
          <span className="arow-main">
            <span className="arow-name">
              <span className={`ab-kind ${e.kind}`}>{e.kind === 'main' ? '主 AGENT' : 'SUBAGENT'}</span>
              <span className="arow-title">{e.title}</span>
            </span>
            <span className={`arow-chip ${e.status}`}><span className={`st-dot ${e.status}`} />{STATUS_LABEL[e.status] ?? e.status}</span>
          </span>
          <span className="arow-meta">{e.steps} 步{e.subKeys.length > 0 ? ` · ${e.subKeys.length} subagent` : ''}</span>
          <span className="arow-go"><GoIcon /></span>
        </button>
      ))}
    </div>
  )
}
