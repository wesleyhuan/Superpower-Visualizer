import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../src/normalizeAnalysis'

describe('normalizeAnalysisResult', () => {
  it('合法結果原樣保留(含 reviewerModel / promptVersion)', () => {
    const ok = {
      verdict: 'bad', summary: '有問題',
      findings: [{ severity: 'high', category: 'danger', step: 2, issue: 'rm -rf', suggestion: '別這樣' }],
      reviewerModel: 'm', promptVersion: 'v2',
    }
    expect(normalizeAnalysisResult(ok)).toEqual(ok)
  })

  it.each([null, undefined, 'oops', 42, [], '<html>502</html>'])('完全不是物件(%s)→ warn 說明,不丟錯', (raw) => {
    const r = normalizeAnalysisResult(raw)
    expect(r.verdict).toBe('warn')
    expect(r.findings).toEqual([])
    expect(r.summary).toContain('格式')
  })

  it('欄位壞掉就夾回預設:findings 不是陣列、未知 verdict/severity/category、step 非數字', () => {
    expect(normalizeAnalysisResult({ verdict: 'great', findings: 'none' })).toEqual({
      verdict: 'warn', summary: '(模型未提供總評)', findings: [],
    })
    const r = normalizeAnalysisResult({ verdict: 'ok', summary: 's', findings: [null, { severity: 'huge', category: 'x', step: 'abc', issue: 3 }] })
    expect(r.findings).toEqual([
      { severity: 'low', category: 'other', step: 0, issue: '', suggestion: '' },
      { severity: 'low', category: 'other', step: 0, issue: '', suggestion: '' },
    ])
  })
})
