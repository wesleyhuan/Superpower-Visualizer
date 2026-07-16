import type { AgentBlock } from '../buildAgentBlocks'
import type { TreeNode } from '../wireTypes'

function itemKind(node: TreeNode): { cls: string; text: string } {
  if (node.type === 'skill') return { cls: 'skill', text: 'SKILL' }
  if (node.type === 'subagent') return { cls: 'subagent', text: 'SUB' }
  if (/^mcp__/.test(node.label) || /^mcp__/.test(node.id)) return { cls: 'mcp', text: 'MCP' }
  return { cls: '', text: 'TOOL' }
}

const Chevron = () => (
  <span className="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></span>
)
const BoltIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
)
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
)
const ArrowIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
// 燈泡 = 「理由 / 想法」(ReAct 的 Reason)
const IdeaIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></svg>
)

const STATUS_LABEL: Record<string, string> = {
  running: '執行中', awaiting: '等待核准', done: '完成', error: '錯誤', failed: '失敗', interrupted: '已中止',
}

// 動手前那句敘述,顯示成該批工具上方的一行「理由」。
function ReasonLine({ text }: { text: string }) {
  return <div className="wreason"><span className="wr-ic"><IdeaIcon /></span><span>{text}</span></div>
}

// 取結果的第一行非空內容當精簡摘要(完整輸出仍在「展開輸出」)。
function firstLine(s?: string): string {
  if (!s) return ''
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
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

function Block({ block, title, outputByNode, kind }: { block: AgentBlock; title: string; outputByNode: Record<string, string>; kind: 'main' | 'sub' }) {
  const status = block.status
  return (
    <>
      <details className={`agent-block ${kind}`} open data-status={status}>
        <summary>
          <span className={`ab-avatar ${kind}`}>{kind === 'main' ? <BoltIcon /> : <UserIcon />}</span>
          <span className="ab-main">
            <span className="ab-titleline">
              <span className={`ab-kind ${kind}`}>{kind === 'main' ? '主 AGENT' : 'SUBAGENT'}</span>
              <span className="ab-title">{title}</span>
            </span>
            <span className="ab-sub">
              {block.items.length + block.children.length} 個步驟
              {block.children.length > 0 && ` · 指派了 ${block.children.length} 個 subagent`}
            </span>
          </span>
          <span className={`ab-status ${status}`}><span className={`st-dot ${status}`} />{STATUS_LABEL[status] ?? status}</span>
          <Chevron />
        </summary>
        <div className="ab-body">
          {(block.items.length > 0 || block.children.length > 0) && <div className="lbl">工作項目 · 想法 → 動作 → 結果</div>}
          <div className="work">
            {block.items.map((n) => (
              <div className="wstep" key={n.id}>
                {n.reason && <ReasonLine text={n.reason} />}
                <WorkItem node={n} output={outputByNode[n.id]} />
              </div>
            ))}
          </div>
        </div>
      </details>
      {block.children.length > 0 && (
        <div className="subgroup">
          <span className="assign-chip"><ArrowIcon />指派任務</span>
          {block.children.map((c) => (
            <div className="subassign" key={c.id}>
              {c.node?.reason && <ReasonLine text={c.node.reason} />}
              <Block block={c} title={c.node?.label ?? '(subagent)'} outputByNode={outputByNode} kind="sub" />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function AgentBlocks({ main, mainTitle, outputByNode = {} }: { main: AgentBlock; mainTitle: string; outputByNode?: Record<string, string> }) {
  return (
    <div className="agents">
      <Block block={main} title={mainTitle} outputByNode={outputByNode} kind="main" />
    </div>
  )
}
