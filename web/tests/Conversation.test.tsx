import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Conversation } from '../src/components/Conversation'

describe('<Conversation>', () => {
  it('有新訊息時自動捲到底', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const { rerender } = render(<Conversation messages={[{ role: 'user', text: 'hi' }]} />)
    spy.mockClear()
    rerender(<Conversation messages={[{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }]} />)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('依角色渲染訊息', () => {
    render(<Conversation messages={[
      { role: 'user', text: '重構登入流程' },
      { role: 'assistant', text: '好的,我先研究結構。' },
    ]} />)
    expect(screen.getByText('重構登入流程').closest('[data-role]')?.getAttribute('data-role')).toBe('user')
    expect(screen.getByText('好的,我先研究結構。').closest('[data-role]')?.getAttribute('data-role')).toBe('assistant')
  })

  it('沒有訊息時顯示空狀態', () => {
    render(<Conversation messages={[]} />)
    expect(screen.getByText(/尚未開始/)).toBeInTheDocument()
  })
})
