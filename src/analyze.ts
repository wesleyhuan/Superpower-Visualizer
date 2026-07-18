import type { AnalysisTrace, AnalysisResult, Verdict, Severity, Finding } from './types'

// 把一個 agent 的 ReAct 軌跡組成給「審查用 Claude」的 prompt。
// 要求:只回 JSON、schema 固定、語言繁中。
export function buildAnalysisPrompt(trace: AnalysisTrace): string {
  const lines = trace.steps.map((s) => {
    const parts = [`步驟 ${s.index} [${s.kind}] ${s.label}(${s.status})`]
    if (s.reason) parts.push(`  想法:${s.reason}`)
    if (s.output) parts.push(`  結果:${s.output}`)
    return parts.join('\n')
  })
  return [
    '你是一位資深工程師,正在審查「另一個 AI agent」完成任務的過程是否合理。',
    `這個 agent 的任務:${trace.title}`,
    '',
    '以下是它的 ReAct 軌跡(想法 → 動作 → 結果),已編號:',
    lines.join('\n'),
    '',
    '請評估整體推論是否妥當:方向對不對、有無多餘/危險/遺漏的步驟、有無更好做法。',
    '只輸出一個 JSON 物件(不要有其他文字,不要 markdown code fence),schema:',
    '{',
    '  "verdict": "ok" | "warn" | "bad",   // 妥當 / 有疑慮 / 有問題',
    '  "summary": "繁體中文總評,2-4 句",',
    '  "findings": [',
    '    { "severity": "high" | "med" | "low", "step": <步驟編號,整體性問題填 0>,',
    '      "issue": "問題是什麼", "suggestion": "建議怎麼改" }',
    '  ]   // 沒問題就給空陣列',
    '}',
    '所有文字用繁體中文。',
  ].join('\n')
}

const VERDICTS: Verdict[] = ['ok', 'warn', 'bad']
const SEVERITIES: Severity[] = ['high', 'med', 'low']

// 從模型回覆抽出 JSON 並驗證/夾限成 AnalysisResult。
// 解析不出來不丟例外,回一個 warn 的說明結果,讓 UI 能優雅顯示。
export function parseVerdict(text: string): AnalysisResult {
  const json = extractJson(text)
  if (!json) {
    console.error('[analyze] 無法從回覆抽出 JSON,原始文字前 500:', text.slice(0, 500))
    return { verdict: 'warn', summary: '分析回覆無法解析為 JSON,請重新分析。', findings: [] }
  }
  let raw: any
  try {
    raw = JSON.parse(json)
  } catch (err) {
    console.error('[analyze] JSON.parse 失敗:', err, '片段:', json.slice(0, 500))
    return { verdict: 'warn', summary: '分析回覆 JSON 格式錯誤,請重新分析。', findings: [] }
  }
  const verdict: Verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'warn'
  const summary = typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary : '(模型未提供總評)'
  const findings: Finding[] = Array.isArray(raw?.findings) ? raw.findings.map(normalizeFinding) : []
  return { verdict, summary, findings }
}

function normalizeFinding(f: any): Finding {
  return {
    severity: SEVERITIES.includes(f?.severity) ? f.severity : 'low',
    step: Number.isFinite(f?.step) ? Number(f.step) : 0,
    issue: typeof f?.issue === 'string' ? f.issue : '',
    suggestion: typeof f?.suggestion === 'string' ? f.suggestion : '',
  }
}

// 抽第一個 { 到最後一個 } 之間的字串(容忍 ```json fence 與前後雜訊)。
function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + 1)
}
