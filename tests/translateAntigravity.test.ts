import { describe, it, expect } from 'vitest'
import { translateAntigravityStep } from '../src/translateAntigravity'

describe('translateAntigravityStep', () => {
  it('type 14 使用者任務 → message(user)', () => {
    const row = { idx: 0, step_type: 14, status: 3, decoded: { text: '幫我重構登入' } }
    expect(translateAntigravityStep(row, null)).toEqual([{ kind: 'message', role: 'user', text: '幫我重構登入' }])
  })

  it('工具 step → label 用 toolSummary(做什麼)、reason 用 toolAction(為什麼)', () => {
    const row = { idx: 2, step_type: 8, status: 3, decoded: { toolName: 'view_file', args: { toolAction: 'Read original user request file', toolSummary: 'Read ORIGINAL_REQUEST.md' } } }
    expect(translateAntigravityStep(row, null)).toEqual([{
      kind: 'tree:node',
      node: { id: 'ag-2', parentId: null, type: 'tool', label: 'view_file: Read ORIGINAL_REQUEST.md', status: 'done', reason: 'Read original user request file' },
    }])
  })

  it('toolAction 與 toolSummary 相同 → 不重複放 reason', () => {
    const row = { idx: 4, step_type: 15, status: 3, decoded: { toolName: 'list_dir', args: { toolAction: 'List dir', toolSummary: 'List dir' } } }
    expect((translateAntigravityStep(row, null)[0] as any).node.reason).toBeUndefined()
  })

  it('bug 回歸:type-15 帶工具(思考+動作同一步)仍產生節點,不被短路丟掉', () => {
    const row = { idx: 1, step_type: 15, status: 3, decoded: { toolName: 'run_command', text: '**Analyzing** …', args: { toolSummary: 'Getting current location' } } }
    const node = (translateAntigravityStep(row, null)[0] as any).node
    expect(node.type).toBe('tool')
    expect(node.label).toBe('run_command: Getting current location')
  })

  it('invoke_subagent → subagent 節點,status 2 → running', () => {
    const row = { idx: 23, step_type: 127, status: 2, decoded: { toolName: 'invoke_subagent', args: { toolSummary: '派 explorer' } } }
    const node = (translateAntigravityStep(row, null)[0] as any).node
    expect(node.type).toBe('subagent')
    expect(node.status).toBe('running')
  })

  it('type 15 純思考(無工具)→ v1 忽略(空陣列)', () => {
    const row = { idx: 8, step_type: 15, status: 3, decoded: { text: "I'm now drafting the plan..." } }
    expect(translateAntigravityStep(row, null)).toEqual([])
  })

  it('無法辨識的 step → 空陣列', () => {
    expect(translateAntigravityStep({ idx: 9, step_type: 99, status: 3, decoded: {} }, null)).toEqual([])
  })
})
