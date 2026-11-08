import type { AnalysisResult, Finding, Verdict, Severity, FindingCategory } from './wireTypes'

// 後端 /analyze 的回傳不一定可信(後端版本不符、代理回 HTML、模型亂回等)。
// 前端渲染時會直接讀 result.findings.map / f.severity…,形狀不對就整頁崩成白屏。
// 這裡鏡射後端 src/analyze.ts 的 parseVerdict:不認得的值夾回預設,形狀完全不對就回 warn。
const VERDICTS: Verdict[] = ['ok', 'warn', 'bad']
const SEVERITIES: Severity[] = ['high', 'med', 'low']
const CATEGORIES: FindingCategory[] = ['danger', 'redundant', 'missing', 'better', 'other']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function normalizeFinding(f: unknown): Finding {
  const o = isObject(f) ? f : {}
  const step = Number(o.step)
  return {
    severity: SEVERITIES.includes(o.severity as Severity) ? (o.severity as Severity) : 'low',
    category: CATEGORIES.includes(o.category as FindingCategory) ? (o.category as FindingCategory) : 'other',
    step: Number.isFinite(step) ? step : 0,
    issue: typeof o.issue === 'string' ? o.issue : '',
    suggestion: typeof o.suggestion === 'string' ? o.suggestion : '',
  }
}

export function normalizeAnalysisResult(raw: unknown): AnalysisResult {
  if (!isObject(raw)) {
    return { verdict: 'warn', summary: '分析回傳的格式無法辨識,請重新分析。', findings: [] }
  }
  const result: AnalysisResult = {
    verdict: VERDICTS.includes(raw.verdict as Verdict) ? (raw.verdict as Verdict) : 'warn',
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary : '(模型未提供總評)',
    findings: Array.isArray(raw.findings) ? raw.findings.map(normalizeFinding) : [],
  }
  if (typeof raw.reviewerModel === 'string') result.reviewerModel = raw.reviewerModel
  if (typeof raw.promptVersion === 'string') result.promptVersion = raw.promptVersion
  return result
}
