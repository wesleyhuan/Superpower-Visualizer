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

const STATUS_LABEL: Record<string, string> = {
  running: '執行中', awaiting: '等待核准', done: '完成', error: '錯誤', failed: '失敗', interrupted: '已中止',
}

function WorkItem({ node, output }: { node: TreeNode; output?: string }) {
  const k = itemKind(node)
  return (
    <div className={`witem ${node.status}`}>
      <div className="witem-row" data-status={node.status}>
        <span className={`st-dot ${node.status}`} />
        <span className={`wkind ${k.cls}`}>{k.text}</span>
        <span className="wl">{node.label}</span>
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
          {(block.items.length > 0 || block.children.length > 0) && <div className="lbl">工作項目 · Tool / MCP</div>}
          <div className="work">
            {block.items.map((n) => <WorkItem key={n.id} node={n} output={outputByNode[n.id]} />)}
          </div>
        </div>
      </details>
      {block.children.length > 0 && (
        <div className="subgroup">
          <span className="assign-chip"><ArrowIcon />指派任務</span>
          {block.children.map((c) => (
            <Block key={c.id} block={c} title={c.node?.label ?? '(subagent)'} outputByNode={outputByNode} kind="sub" />
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
