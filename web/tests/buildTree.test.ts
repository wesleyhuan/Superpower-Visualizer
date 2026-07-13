import { describe, it, expect } from 'vitest'
import { buildTree } from '../src/buildTree'
import type { TreeNode } from '../src/wireTypes'

const N = (id: string, parentId: string | null): TreeNode =>
  ({ id, parentId, type: 'tool', label: id, status: 'running' })

describe('buildTree', () => {
  it('把扁平節點依 parentId 建成巢狀,並保留插入順序', () => {
    const nodes = { root: N('root', null), c1: N('c1', 'root'), c2: N('c2', 'root') }
    const order = ['root', 'c1', 'c2']
    const tree = buildTree({ nodes, order })
    expect(tree).toHaveLength(1)
    expect(tree[0].node.id).toBe('root')
    expect(tree[0].children.map((c) => c.node.id)).toEqual(['c1', 'c2'])
  })

  it('parentId 指向不存在的節點時,視為根(不遺失)', () => {
    const nodes = { orphan: N('orphan', 'ghost') }
    const tree = buildTree({ nodes, order: ['orphan'] })
    expect(tree).toHaveLength(1)
    expect(tree[0].node.id).toBe('orphan')
  })
})
