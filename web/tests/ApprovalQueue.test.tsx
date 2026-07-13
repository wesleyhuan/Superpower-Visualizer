import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalQueue } from '../src/components/ApprovalQueue'

describe('<ApprovalQueue>', () => {
  it('列出每筆 pending,按核准會以 toolUseId + true 回呼', () => {
    const onDecide = vi.fn()
    render(<ApprovalQueue pending={[{ toolUseId: 't1', name: 'Bash', input: { command: 'ls' } }]} onDecide={onDecide} />)
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '核准' }))
    expect(onDecide).toHaveBeenCalledWith('t1', true)
  })
})
