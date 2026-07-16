import { describe, it, expect } from 'vitest'
import { translateAntigravityStep } from '../src/translateAntigravity'

describe('translateAntigravityStep', () => {
  it('type 14 使用者任務 → message(user)', () => {
    const row = { idx: 0, step_type: 14, status: 3, decoded: { text: '幫我重構登入' } }
    expect(translateAntigravityStep(row, null)).toEqual([{ kind: 'message', role: 'user', text: '幫我重構登入' }])
  })

  it('工具 step → tree:node,reason=toolAction,status 由欄位對映', () => {
    const row = { idx: 2, step_type: 8, status: 3, decoded: { toolName: 'view_file', args: { toolAction: 'Read original user request file', toolSummary: 'Read x' } } }
    expect(translateAntigravityStep(row, null)).toEqual([{
      kind: 'tree:node',
      node: { id: 'ag-2', parentId: null, type: 'tool', label: 'view_file: Read x', status: 'done', reason: 'Read original user request file' },
    }])
  })

  it('invoke_subagent → subagent 節點,status 2 → running', () => {
    const row = { idx: 23, step_type: 127, status: 2, decoded: { toolName: 'invoke_subagent', args: { toolSummary: '派 explorer' } } }
    const node = (translateAntigravityStep(row, null)[0] as any).node
    expect(node.type).toBe('subagent')
    expect(node.status).toBe('running')
  })

  it('type 15 assistant 思考 → v1 忽略(空陣列)', () => {
    const row = { idx: 8, step_type: 15, status: 3, decoded: { text: "I'm now drafting the plan..." } }
    expect(translateAntigravityStep(row, null)).toEqual([])
  })

  it('無法辨識的 step → 空陣列', () => {
    expect(translateAntigravityStep({ idx: 9, step_type: 99, status: 3, decoded: {} }, null)).toEqual([])
  })
})
