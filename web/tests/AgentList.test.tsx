import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentList } from '../src/components/AgentList'
import type { AgentEntry } from '../src/buildAgentBlocks'

const entries: AgentEntry[] = [
  { key: 'main', title: '重構登入', kind: 'main', status: 'running', steps: 3, items: [], subKeys: ['s1'] },
  { key: 's1', title: '研究結構', kind: 'sub', status: 'done', steps: 2, items: [], subKeys: [] },
]

describe('<AgentList>', () => {
  it('每個 agent 一列,顯示標題 / 步數 / subagent 數', () => {
    render(<AgentList entries={entries} onOpen={vi.fn()} />)
    expect(screen.getByText('重構登入')).toBeInTheDocument()
    expect(screen.getByText('研究結構')).toBeInTheDocument()
    expect(screen.getByText(/3 步/)).toBeInTheDocument()
    expect(screen.getByText(/1 subagent/)).toBeInTheDocument()
  })

  it('點某列 → onOpen(index)', () => {
    const onOpen = vi.fn()
    render(<AgentList entries={entries} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('研究結構'))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
})
