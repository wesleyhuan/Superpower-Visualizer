import type { TreeNode } from './wireTypes'

export interface TreeItem { node: TreeNode; children: TreeItem[] }

export function buildTree(state: { nodes: Record<string, TreeNode>; order: string[] }): TreeItem[] {
  const items = new Map<string, TreeItem>()
  for (const id of state.order) items.set(id, { node: state.nodes[id], children: [] })

  const roots: TreeItem[] = []
  for (const id of state.order) {
    const item = items.get(id)!
    const parentId = item.node.parentId
    const parent = parentId ? items.get(parentId) : undefined
    if (parent) parent.children.push(item)
    else roots.push(item) // parentId 為 null 或指向不存在節點 → 視為根
  }
  return roots
}
