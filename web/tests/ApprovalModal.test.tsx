import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalModal } from '../src/components/ApprovalModal'

describe('<ApprovalModal>', () => {
  it('沒有 pending 時不渲染', () => {
    const { container } = render(<ApprovalModal pending={[]} onDecide={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('顯示第一筆 pending,按核准以 (toolUseId, true) 回呼', () => {
    const onDecide = vi.fn()
    render(<ApprovalModal pending={[{ toolUseId: 't1', name: 'Write', input: { file_path: 'a.ts' } }]} onDecide={onDecide} />)
    expect(screen.getByText(/Write/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '核准' }))
    expect(onDecide).toHaveBeenCalledWith('t1', true)
  })

  it('按拒絕以 (toolUseId, false) 回呼', () => {
    const onDecide = vi.fn()
    render(<ApprovalModal pending={[{ toolUseId: 't1', name: 'Bash', input: {} }]} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: '拒絕' }))
    expect(onDecide).toHaveBeenCalledWith('t1', false)
  })
})
