import { describe, it, expect } from 'vitest'
import { buildAnalysisTrace } from '../src/buildAgentBlocks'
import type { AgentEntry } from '../src/buildAgentBlocks'

const entry: AgentEntry = {
  key: 'main', title: '做計算機', kind: 'main', status: 'done', steps: 3, items: [
    { id: 'a', parentId: null, type: 'tool', label: 'Grep: x', status: 'done', reason: '先找' },
    { id: 'mcp__db__query', parentId: null, type: 'tool', label: 'mcp__db__query', status: 'done' },
    { id: 'c', parentId: null, type: 'skill', label: 'brainstorming', status: 'done' },
  ], subKeys: [],
}

describe('buildAnalysisTrace', () => {
  it('items → 編號 steps,帶入 title/kind', () => {
    const t = buildAnalysisTrace(entry, {})
    expect(t.title).toBe('做計算機')
    expect(t.kind).toBe('main')
    expect(t.steps.map((s) => s.index)).toEqual([1, 2, 3])
    expect(t.steps[0].reason).toBe('先找')
  })
  it('kind 分類:mcp__ → MCP、skill → SKILL、其餘 → TOOL', () => {
    const t = buildAnalysisTrace(entry, {})
    expect(t.steps[0].kind).toBe('TOOL')
    expect(t.steps[1].kind).toBe('MCP')
    expect(t.steps[2].kind).toBe('SKILL')
  })
  it('output 截斷至 500 字', () => {
    const long = 'x'.repeat(900)
    const t = buildAnalysisTrace(entry, { a: long })
    expect(t.steps[0].output).toHaveLength(500)
  })
})
