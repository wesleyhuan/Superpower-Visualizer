import { describe, it, expect } from 'vitest'
import { buildAnalysisRecord } from '../src/buildAnalysisRecord'
import type { AnalysisTrace, AnalysisResult } from '../src/wireTypes'

const trace: AnalysisTrace = {
  title: '重構登入流程',
  kind: 'main',
  steps: [{ index: 1, label: 'Grep: password', kind: 'TOOL', status: 'done' }],
}
const result: AnalysisResult = {
  verdict: 'warn',
  summary: '還行',
  findings: [{ severity: 'high', step: 1, issue: 'i', suggestion: 's' }],
  reviewerModel: 'claude-opus-4-8',
  promptVersion: 'v1',
}
const at = new Date('2026-07-28T00:00:00.000Z')

describe('buildAnalysisRecord', () => {
  it('組出完整可重現的評估記錄:meta + trace + 純 verdict', () => {
    const rec = buildAnalysisRecord(trace, result, at)
    expect(rec.schemaVersion).toBe(1)
    expect(rec.capturedAt).toBe('2026-07-28T00:00:00.000Z')
    expect(rec.reviewerModel).toBe('claude-opus-4-8')
    expect(rec.promptVersion).toBe('v1')
    expect(rec.trace).toEqual(trace)
  })

  it('result 只留 verdict/summary/findings,provenance 提到頂層不重複', () => {
    const rec = buildAnalysisRecord(trace, result, at)
    expect(rec.result).toEqual({ verdict: 'warn', summary: '還行', findings: result.findings })
    expect(rec.result).not.toHaveProperty('reviewerModel')
    expect(rec.result).not.toHaveProperty('promptVersion')
  })

  it('後端沒帶 model/版本 → 標為 unknown(不讓欄位消失)', () => {
    const bare: AnalysisResult = { verdict: 'ok', summary: 'g', findings: [] }
    const rec = buildAnalysisRecord(trace, bare, at)
    expect(rec.reviewerModel).toBe('unknown')
    expect(rec.promptVersion).toBe('unknown')
  })
})
