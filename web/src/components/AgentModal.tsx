import { useEffect, useRef, useState } from 'react'
import type { AgentEntry } from '../buildAgentBlocks'
import { buildAnalysisTrace, classifyKind } from '../buildAgentBlocks'
import type { TreeNode, AnalysisState, AnalysisResult, AnalysisTrace, Verdict, Severity } from '../wireTypes'

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
const ScaleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6m0 0-2.2 8.5a1 1 0 0 0 1 .5h2.4a1 1 0 0 0 1-.5L13 9M5 9h14" /><circle cx="12" cy="4" r="1.4" /></svg>
)
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
)
const VERDICT_LABEL: Record<Verdict, string> = { ok: '妥當', warn: '有疑慮', bad: '有問題' }
const SEV_LABEL: Record<Severity, string> = { high: '高', med: '中', low: '低' }

function verdictCount(findings: { severity: Severity }[]): string {
  if (findings.length === 0) return '沒有發現問題'
  const c = { high: 0, med: 0, low: 0 }
  for (const f of findings) c[f.severity]++
  return `${findings.length} 個指摘 · ${c.high} 高 · ${c.med} 中 · ${c.low} 低`
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
  const k = classifyKind(node)
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

function AnalysisPanel({ result, stepLabel, onStep }: {
  result: AnalysisResult
  stepLabel: (step: number) => string | undefined
  onStep: (step: number) => void
}) {
  return (
    <div className="analysis">
      <div className="analysis-head">
        <span className="lbl">合理性分析</span>
        <span className="by"><BoltIcon /> Claude 審查</span>
      </div>
      <div className="summary">{result.summary}</div>
      {result.findings.length > 0 && (
        <div className="findings">
          {result.findings.map((f, i) => (
            <div className={`finding ${f.severity}`} key={i}>
              <div className="f-top">
                <span className={`sev ${f.severity}`}>{SEV_LABEL[f.severity]}</span>
                {f.step > 0 && (
                  <button className="f-step" onClick={() => onStep(f.step)}>步驟 {f.step}</button>
                )}
                {f.step > 0 && stepLabel(f.step) && <span className="f-action">{stepLabel(f.step)}</span>}
              </div>
              <div className="f-issue">{f.issue}</div>
              {f.suggestion && (
                <div className="f-fix"><span className="fx-ic"><CheckIcon /></span><span>{f.suggestion}</span></div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  entries: AgentEntry[]
  index: number
  outputByNode: Record<string, string>
  analysisByKey: Record<string, AnalysisState>
  onAnalyze: (key: string, trace: AnalysisTrace) => void
  onIndex: (index: number) => void
  onClose: () => void
}

// 置中彈窗:目前 agent 的完整 ReAct 時間軸 + subagent chip 切換 + ← → 導覽(帶位置文字)。
export function AgentModal({ entries, index, outputByNode, analysisByKey, onAnalyze, onIndex, onClose }: Props) {
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

  const bodyRef = useRef<HTMLDivElement>(null)
  const [flashStep, setFlashStep] = useState<number | null>(null)

  if (!cur) return null
  const subs = cur.subKeys
    .map((k) => entries.findIndex((e) => e.key === k))
    .filter((i) => i >= 0)
    .map((i) => ({ i, entry: entries[i] }))

  const analysis = analysisByKey[cur.key]
  const canAnalyze = cur.items.length > 0
  const doAnalyze = () => onAnalyze(cur.key, buildAnalysisTrace(cur, outputByNode))

  const scrollToStep = (step: number) => {
    const el = bodyRef.current?.querySelector(`[data-step="${step}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashStep(step)
    setTimeout(() => setFlashStep(null), 1400)
  }
  const stepLabel = (step: number) => cur.items[step - 1]?.label

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

        <div className="am-analyze">
          {!analysis && (
            <>
              <button className="analyze-btn" onClick={doAnalyze} disabled={!canAnalyze}>
                <ScaleIcon /> 分析合理性
              </button>
              <span className="analyze-hint">
                {canAnalyze ? '用另一個 Claude 檢查這個 agent 的推論是否妥當' : '沒有可分析的步驟'}
              </span>
            </>
          )}
          {analysis?.status === 'loading' && (
            <span className="analyze-loading"><span className="spin" /> 分析中…</span>
          )}
          {analysis?.status === 'done' && analysis.result && (
            <div className="verdict">
              <span className={`vbadge ${analysis.result.verdict}`}>{VERDICT_LABEL[analysis.result.verdict]}</span>
              <span className="vcount">{verdictCount(analysis.result.findings)}</span>
              <button className="reanalyze" onClick={doAnalyze}>重新分析</button>
            </div>
          )}
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

        <div className="am-body" ref={bodyRef}>
          {analysis?.status === 'done' && analysis.result && (
            <AnalysisPanel result={analysis.result} stepLabel={stepLabel} onStep={scrollToStep} />
          )}
          {cur.items.length > 0
            ? (
              <>
                <div className="lbl">工作項目 · 想法 → 動作 → 結果</div>
                <div className="work">
                  {cur.items.map((n, i) => (
                    <div className={`wstep${flashStep === i + 1 ? ' flash' : ''}`} data-step={i + 1} key={n.id}>
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
