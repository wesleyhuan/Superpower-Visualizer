import type { AnalysisTrace } from './types'

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
