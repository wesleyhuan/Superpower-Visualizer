import type { AnalysisTrace, AnalysisResult, Verdict, Finding } from './wireTypes'

// 一筆可重現的評估記錄:被審 agent 的軌跡 + 這次審核結果 + 出處(哪個模型、哪版 prompt)。
// 讓其他模型可(a)只吃 trace 重跑同一份審核,或(b)吃 trace+result 裁判這次審得合不合理。
export interface AnalysisRecord {
  schemaVersion: number
  capturedAt: string
  reviewerModel: string
  promptVersion: string
  trace: AnalysisTrace
  result: { verdict: Verdict; summary: string; findings: Finding[] }
}

export function buildAnalysisRecord(
  trace: AnalysisTrace,
  result: AnalysisResult,
  now: Date = new Date(),
): AnalysisRecord {
  // provenance 提到頂層,result 只留純 verdict(避免同一資訊重複兩份)。
  const { reviewerModel, promptVersion, ...verdict } = result
  return {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    reviewerModel: reviewerModel ?? 'unknown',
    promptVersion: promptVersion ?? 'unknown',
    trace,
    result: verdict,
  }
}

// 把物件當 JSON 檔下載(前端命令式外殼,jsdom 無 createObjectURL 故不進單元測試)。
export function downloadJson(filename: string, data: unknown): void {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('[downloadJson] 下載失敗', err)
  }
}
