import { describe, it, expect } from 'vitest'
import { buildAnalysisPrompt } from '../src/analyze'
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
