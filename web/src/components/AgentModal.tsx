import { useEffect } from 'react'
import type { AgentEntry } from '../buildAgentBlocks'
import type { TreeNode } from '../wireTypes'

const STATUS_LABEL: Record<string, string> = {
  running: '執行中', awaiting: '等待核准', done: '完成', error: '錯誤', failed: '失敗', interrupted: '已中止',
}

const BoltIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)
const UserIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
)
const IdeaIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></svg>
)
const arrow = (dir: 'l' | 'r') => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={dir === 'l' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
)

function itemKind(node: TreeNode): { cls: string; text: string } {
  if (node.type === 'skill') return { cls: 'skill', text: 'SKILL' }
  if (node.type === 'subagent') return { cls: 'subagent', text: 'SUB' }
  if (/^mcp__/.test(node.label) || /^mcp__/.test(node.id)) return { cls: 'mcp', text: 'MCP' }
  return { cls: '', text: 'TOOL' }
}

// 取結果第一行非空內容當精簡摘要(完整輸出仍在「展開輸出」)。
function firstLine(s?: string): string {
  if (!s) return ''
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

function ReasonLine({ text }: { text: string }) {
  return <div className="wreason"><span className="wr-ic"><IdeaIcon /></span><span>{text}</span></div>
}

function WorkItem({ node, output }: { node: TreeNode; output?: string }) {
  const k = itemKind(node)
  const summary = firstLine(output)
  return (
    <div className={`witem ${node.status}`}>
      <div className="witem-row" data-status={node.status}>
        <span className={`st-dot ${node.status}`} />
        <span className={`wkind ${k.cls}`}>{k.text}</span>
        <span className="wl">{node.label}</span>
        {summary && <span className="wsum" title={summary}>{summary}</span>}
      </div>
      {output && output.trim() !== '' && (
        <details className="dump">
          <summary>展開輸出</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  )
}

interface Props {
  entries: AgentEntry[]
  index: number
  outputByNode: Record<string, string>
  onIndex: (index: number) => void
  onClose: () => void
}

// 置中彈窗:目前 agent 的完整 ReAct 時間軸 + subagent chip 切換 + ← → 導覽(帶位置文字)。
export function AgentModal({ entries, index, outputByNode, onIndex, onClose }: Props) {
  const cur = entries[index]
  const hasPrev = index > 0
  const hasNext = index < entries.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1)
      else if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, hasPrev, hasNext, onIndex, onClose])

  if (!cur) return null
  const subs = cur.subKeys
    .map((k) => entries.findIndex((e) => e.key === k))
    .filter((i) => i >= 0)
    .map((i) => ({ i, entry: entries[i] }))

  return (
    <div className="scrim open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="agent-modal" role="dialog" aria-modal="true" aria-label={cur.title}>
        <div className="am-head">
          <span className={`arow-avatar ${cur.kind}`}>{cur.kind === 'main' ? <BoltIcon /> : <UserIcon />}</span>
          <span className="am-htext">
            <span className="am-title">{cur.title}</span>
            <span className="am-meta">{cur.kind === 'main' ? '主 AGENT' : 'SUBAGENT'} · {cur.steps} 步 · {STATUS_LABEL[cur.status] ?? cur.status}</span>
          </span>
          <span className="am-nav">
            <span className="am-pos">{index + 1} / {entries.length}</span>
            <button className="am-navbtn" aria-label="上一個 agent" disabled={!hasPrev} onClick={() => onIndex(index - 1)}>{arrow('l')}</button>
            <button className="am-navbtn" aria-label="下一個 agent" disabled={!hasNext} onClick={() => onIndex(index + 1)}>{arrow('r')}</button>
            <button className="am-close" aria-label="關閉" onClick={onClose}>✕</button>
          </span>
        </div>

        {subs.length > 0 && (
          <div className="am-subs">
            <span className="am-subs-label">指派的 subagent</span>
            {subs.map(({ i, entry }) => (
              <button key={entry.key} className="subchip" onClick={() => onIndex(i)}>
                <span className={`st-dot ${entry.status}`} />{entry.title}
              </button>
            ))}
          </div>
        )}

        <div className="am-body">
          {cur.items.length > 0
            ? (
              <>
                <div className="lbl">工作項目 · 想法 → 動作 → 結果</div>
                <div className="work">
                  {cur.items.map((n) => (
                    <div className="wstep" key={n.id}>
                      {n.reason && <ReasonLine text={n.reason} />}
                      <WorkItem node={n} output={outputByNode[n.id]} />
                    </div>
                  ))}
                </div>
              </>
            )
            : <div className="am-empty">這個 agent 還沒有工作項目。</div>}
        </div>
      </div>
    </div>
  )
}
