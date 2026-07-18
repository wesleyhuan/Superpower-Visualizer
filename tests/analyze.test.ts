import { describe, it, expect } from 'vitest'
import { buildAnalysisPrompt, parseVerdict } from '../src/analyze'
import type { AnalysisTrace } from '../src/types'

const trace: AnalysisTrace = {
  title: '重構登入流程',
  kind: 'main',
  steps: [
    { index: 1, label: 'Grep: password', kind: 'TOOL', status: 'done', reason: '先找雜湊在哪' },
    { index: 2, label: 'Write: src/auth.ts', kind: 'TOOL', status: 'done', output: 'wrote 20 lines' },
  ],
}

describe('buildAnalysisPrompt', () => {
  it('逐步編號、帶入任務標題與想法/結果', () => {
    const p = buildAnalysisPrompt(trace)
    expect(p).toContain('重構登入流程')
    expect(p).toContain('步驟 1')
    expect(p).toContain('先找雜湊在哪')
    expect(p).toContain('步驟 2')
    expect(p).toContain('wrote 20 lines')
  })
  it('要求只回固定 schema 的 JSON、且用繁體中文', () => {
    const p = buildAnalysisPrompt(trace)
    expect(p).toContain('verdict')
    expect(p).toContain('findings')
    expect(p).toContain('繁體中文')
  })
})

describe('parseVerdict', () => {
  it('正常 JSON → 對應結果', () => {
    const r = parseVerdict('{"verdict":"warn","summary":"還行","findings":[{"severity":"high","step":2,"issue":"覆寫風險","suggestion":"先讀檔"}]}')
    expect(r.verdict).toBe('warn')
    expect(r.summary).toBe('還行')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ severity: 'high', step: 2, issue: '覆寫風險', suggestion: '先讀檔' })
  })
  it('容忍 ```json fence 與前後雜訊', () => {
    const r = parseVerdict('這是我的判斷:\n```json\n{"verdict":"ok","summary":"沒問題","findings":[]}\n```\n以上')
    expect(r.verdict).toBe('ok')
    expect(r.findings).toEqual([])
  })
  it('非法 verdict/severity 夾限、step 非數字歸 0', () => {
    const r = parseVerdict('{"verdict":"great","summary":"x","findings":[{"severity":"critical","step":"abc","issue":"i","suggestion":"s"}]}')
    expect(r.verdict).toBe('warn')                 // 非列舉 → warn
    expect(r.findings[0].severity).toBe('low')     // 非列舉 → low
    expect(r.findings[0].step).toBe(0)             // 非數字 → 0
  })
  it('完全抽不出 JSON → warn fallback、findings 空', () => {
    const r = parseVerdict('抱歉我無法分析')
    expect(r.verdict).toBe('warn')
    expect(r.findings).toEqual([])
  })
  it('findings 缺欄位 → 補齊為空字串', () => {
    const r = parseVerdict('{"verdict":"bad","summary":"s","findings":[{"severity":"med","step":1}]}')
    expect(r.findings[0].issue).toBe('')
    expect(r.findings[0].suggestion).toBe('')
  })
})
