import { useEffect, useRef, useState } from 'react'
import { useModalFocus } from '../hooks/useModalFocus'
import type { AgentEntry } from '../buildAgentBlocks'
import { buildAnalysisTrace, classifyKind } from '../buildAgentBlocks'
import { buildAnalysisRecord, downloadJson } from '../buildAnalysisRecord'
import type { TreeNode, AnalysisState, AnalysisResult, AnalysisTrace, Verdict, Severity, FindingCategory, Finding } from '../wireTypes'

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
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
)
const VERDICT_LABEL: Record<Verdict, string> = { ok: '妥當', warn: '有疑慮', bad: '有問題' }
const SEV_LABEL: Record<Severity, string> = { high: '高', med: '中', low: '低' }
const CAT_LABEL: Record<FindingCategory, string> = {
  danger: '危險操作', redundant: '多餘步驟', missing: '遺漏', better: '更好做法', other: '其他',
}
// 分類小圖示(14px,繼承色);other 用泛用圓點,不喧賓奪主。
const CatIcon = ({ cat }: { cat: FindingCategory }) => {
  const paths: Record<FindingCategory, string> = {
    danger: 'M12 3 2 20h20L12 3zM12 10v4M12 17.5v.5',
    redundant: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    missing: 'M12 5v6l4 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
    better: 'M12 3a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 3zM9 22h6',
    other: 'M12 12h.01',
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[cat]} /></svg>
  )
}

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

// 嚴重度堆疊條:高/中/低各佔一段,寬度依數量;全 0 時不畫。
function SeverityBar({ findings }: { findings: Finding[] }) {
  const c = { high: 0, med: 0, low: 0 }
  for (const f of findings) c[f.severity]++
  const total = c.high + c.med + c.low
  if (total === 0) return null
  const seg = (s: Severity, n: number) =>
    n > 0 ? <i className={`sbar-seg ${s}`} style={{ width: `${(n / total) * 100}%` }} key={s} /> : null
  return (
    <span className="sbar" title={`${c.high} 高 · ${c.med} 中 · ${c.low} 低`} aria-hidden="true">
      {seg('high', c.high)}{seg('med', c.med)}{seg('low', c.low)}
    </span>
  )
}

// 單張指摘卡:嚴重度 + 分類 + 問題 + 建議。就地掛在對應步驟下,或(step 0)放判定帶。
function FindingCard({ f }: { f: Finding }) {
  return (
    <div className={`fin ${f.severity}`}>
      <div className="fin-top">
        <span className={`sev ${f.severity}`}>{SEV_LABEL[f.severity]}</span>
        <span className="fin-cat"><CatIcon cat={f.category} />{CAT_LABEL[f.category]}</span>
      </div>
      <div className="f-issue">{f.issue}</div>
      {f.suggestion && (
        <div className="f-fix"><span className="fx-ic"><CheckIcon /></span><span>{f.suggestion}</span></div>
      )}
    </div>
  )
}

// 判定帶:彩色左邊條(依 verdict)+ 總評 + 嚴重度堆疊條 + 無法定位到單一步驟的指摘。
// overall = step 0(整體性)或超出步數範圍的指摘;放這裡以免它們在就地內嵌設計下消失。
function VerdictBand({ result, overall }: { result: AnalysisResult; overall: Finding[] }) {
  return (
    <div className={`vband ${result.verdict}`}>
      <div className="vband-top">
        <div className="summary">{result.summary}</div>
        <SeverityBar findings={result.findings} />
      </div>
      {overall.length > 0 && (
        <div className="vband-overall">
          {overall.map((f, i) => <FindingCard f={f} key={i} />)}
        </div>
      )}
    </div>
  )
}

// 健康條:每步一格,被指摘的步驟依「最高嚴重度」上色 + ! 標記;點格子跳到該步。
const SEV_RANK: Record<Severity, number> = { low: 1, med: 2, high: 3 }
function HealthStrip({ steps, worstByStep, onStep }: {
  steps: number
  worstByStep: Map<number, Severity>
  onStep: (step: number) => void
}) {
  return (
    <div className="strip">
      <div className="strip-lbl">步驟健康條 · 點格子跳到該步</div>
      <div className="cells">
        {Array.from({ length: steps }, (_, i) => {
          const step = i + 1
          const sev = worstByStep.get(step)
          return (
            <button
              key={step}
              className={`cell${sev ? ` ${sev}` : ''}`}
              onClick={() => onStep(step)}
              aria-label={sev ? `步驟 ${step}:${SEV_LABEL[sev]}嚴重度指摘` : `步驟 ${step}`}
            >
              {sev && <b>!</b>}
            </button>
          )
        })}
      </div>
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
  const modalRef = useModalFocus<HTMLDivElement>()
  const [flashStep, setFlashStep] = useState<number | null>(null)

  if (!cur) return null
  const subs = cur.subKeys
    .map((k) => entries.findIndex((e) => e.key === k))
    .filter((i) => i >= 0)
    .map((i) => ({ i, entry: entries[i] }))

  const analysis = analysisByKey[cur.key]
  const canAnalyze = cur.items.length > 0
  const doAnalyze = () => onAnalyze(cur.key, buildAnalysisTrace(cur, outputByNode))

  // 匯出這次審核為評估記錄(trace + result + 出處),供其他模型重跑/裁判。
  const doExport = (result: AnalysisResult) => {
    const record = buildAnalysisRecord(buildAnalysisTrace(cur, outputByNode), result)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeKey = cur.key.replace(/[^\w.-]/g, '_')
    downloadJson(`analysis-${safeKey}-${stamp}.json`, record)
  }

  const scrollToStep = (step: number) => {
    const el = bodyRef.current?.querySelector(`[data-step="${step}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashStep(step)
    setTimeout(() => setFlashStep(null), 1400)
  }

  // 依步驟聚合指摘:能對到某步(1..N)的就地掛在該工作項目下,worstByStep 供健康條上色。
  // 對不到步驟的(step 0 整體性,或模型回傳超出範圍的 step)歸為 overall,放判定帶以免消失。
  const result = analysis?.status === 'done' ? analysis.result : undefined
  const stepCount = cur.items.length
  const findingsByStep = new Map<number, Finding[]>()
  const worstByStep = new Map<number, Severity>()
  const overallFindings: Finding[] = []
  for (const f of result?.findings ?? []) {
    if (f.step < 1 || f.step > stepCount) { overallFindings.push(f); continue }
    findingsByStep.set(f.step, [...(findingsByStep.get(f.step) ?? []), f])
    const worst = worstByStep.get(f.step)
    if (!worst || SEV_RANK[f.severity] > SEV_RANK[worst]) worstByStep.set(f.step, f.severity)
  }

  return (
    <div className="scrim open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="agent-modal" role="dialog" aria-modal="true" aria-label={cur.title} ref={modalRef}>
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
            <button className="am-close" aria-label="關閉" onClick={onClose}><CloseIcon /></button>
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
              <button className="reanalyze" onClick={() => doExport(analysis.result!)}>匯出 JSON</button>
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
          {result && <VerdictBand result={result} overall={overallFindings} />}
          {result && worstByStep.size > 0 && (
            <HealthStrip steps={cur.items.length} worstByStep={worstByStep} onStep={scrollToStep} />
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
                      {(findingsByStep.get(i + 1) ?? []).map((f, j) => <FindingCard f={f} key={j} />)}
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
