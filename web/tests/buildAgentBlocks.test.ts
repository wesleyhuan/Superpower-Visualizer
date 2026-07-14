import { describe, it, expect } from 'vitest'
import { buildAgentBlocks } from '../src/buildAgentBlocks'
import type { TreeNode, NodeType, NodeStatus } from '../src/wireTypes'

const N = (id: string, parentId: string | null, type: NodeType, status: NodeStatus = 'done'): TreeNode =>
  ({ id, parentId, type, label: id, status })

describe('buildAgentBlocks', () => {
  it('主 agent 收集 root 層的 tool/skill 為工作項目', () => {
    const nodes = { a: N('a', null, 'tool'), b: N('b', null, 'skill') }
    const { main } = buildAgentBlocks({ nodes, order: ['a', 'b'] })
    expect(main.node).toBeNull()
    expect(main.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(main.children).toHaveLength(0)
  })

  it('subagent 節點變成一個子區塊,其 children 為工作項目', () => {
    const nodes = {
      t: N('t', null, 'subagent', 'running'),
      g: N('g', 't', 'tool'),
      r: N('r', 't', 'tool'),
    }
    const { main } = buildAgentBlocks({ nodes, order: ['t', 'g', 'r'] })
    expect(main.items).toHaveLength(0)         // subagent 不算主 agent 的工作項目
    expect(main.children).toHaveLength(1)
    const sub = main.children[0]
    expect(sub.node?.id).toBe('t')
    expect(sub.status).toBe('running')
    expect(sub.items.map((i) => i.id)).toEqual(['g', 'r'])
  })

  it('巢狀 subagent:子區塊底下再掛子區塊', () => {
    const nodes = {
      t1: N('t1', null, 'subagent'),
      t2: N('t2', 't1', 'subagent'),
      x: N('x', 't2', 'tool'),
    }
    const { main } = buildAgentBlocks({ nodes, order: ['t1', 't2', 'x'] })
    expect(main.children[0].children[0].node?.id).toBe('t2')
    expect(main.children[0].children[0].items.map((i) => i.id)).toEqual(['x'])
  })

  it('主 agent 狀態:有 awaiting 子節點 → awaiting', () => {
    const nodes = { a: N('a', null, 'tool', 'awaiting') }
    const { main } = buildAgentBlocks({ nodes, order: ['a'] })
    expect(main.status).toBe('awaiting')
  })
})
