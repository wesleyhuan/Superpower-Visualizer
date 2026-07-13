import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogStream } from '../src/components/LogStream'
import type { LogEntry } from '../src/wireTypes'

const logs: LogEntry[] = [
  { ts: 1, nodeId: 'a', text: 'hello', level: 'info' },
  { ts: 2, nodeId: 'b', text: 'boom', level: 'error' },
]

describe('<LogStream>', () => {
  it('渲染所有 log,error 帶 data-level', () => {
    render(<LogStream logs={logs} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('boom').closest('[data-level]')?.getAttribute('data-level')).toBe('error')
  })
  it('filterNodeId 只顯示該節點的 log', () => {
    render(<LogStream logs={logs} filterNodeId="a" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.queryByText('boom')).toBeNull()
  })
})
