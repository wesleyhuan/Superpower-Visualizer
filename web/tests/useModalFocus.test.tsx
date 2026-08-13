import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useModalFocus } from '../src/hooks/useModalFocus'

function Harness() {
  const ref = useModalFocus<HTMLDivElement>()
  return (
    <div ref={ref}>
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  )
}

describe('useModalFocus', () => {
  it('掛載時聚焦第一個可聚焦元素', () => {
    const { getByText } = render(<Harness />)
    expect(document.activeElement).toBe(getByText('first'))
  })

  it('Tab focus trap:焦點在最後一個時 Tab → 繞回第一個', () => {
    const { getByText, container } = render(<Harness />)
    getByText('last').focus()
    fireEvent.keyDown(container.firstChild!, { key: 'Tab' })
    expect(document.activeElement).toBe(getByText('first'))
  })

  it('Shift+Tab 在第一個時 → 繞回最後一個', () => {
    const { getByText, container } = render(<Harness />)
    getByText('first').focus()
    fireEvent.keyDown(container.firstChild!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByText('last'))
  })
})
