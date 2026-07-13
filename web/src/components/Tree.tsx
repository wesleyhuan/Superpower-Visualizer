import type { TreeItem } from '../buildTree'

const STATUS_ICON: Record<string, string> = {
  running: '⏳', awaiting: '🟡', done: '✅', error: '❌', interrupted: '⚪', failed: '💥',
}

function Node({ item }: { item: TreeItem }) {
  return (
    <li>
      <span data-status={item.node.status} data-type={item.node.type}>
        {STATUS_ICON[item.node.status] ?? '•'} <span>{item.node.label}</span>
      </span>
      {item.children.length > 0 && (
        <ul>{item.children.map((c) => <Node key={c.node.id} item={c} />)}</ul>
      )}
    </li>
  )
}

export function Tree({ items }: { items: TreeItem[] }) {
  return <ul>{items.map((i) => <Node key={i.node.id} item={i} />)}</ul>
}
