import type { LogEntry } from '../wireTypes'

export function LogStream({ logs, filterNodeId }: { logs: LogEntry[]; filterNodeId?: string | null }) {
  const shown = filterNodeId ? logs.filter((l) => l.nodeId === filterNodeId) : logs
  return (
    <div>
      {shown.map((l, i) => (
        <div key={i} data-level={l.level}>{l.text}</div>
      ))}
    </div>
  )
}
