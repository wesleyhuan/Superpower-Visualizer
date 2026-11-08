import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ErrorBoundary } from '../src/components/ErrorBoundary'

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('壞掉的資料')
  return <p>正常內容</p>
}

describe('<ErrorBoundary>', () => {
  it('子元件 render 丟錯 → 顯示備援畫面,而不是整頁空白', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {}) // React 會印錯誤,測試裡靜音
    render(
      <div>
        <p>外面的東西</p>
        <ErrorBoundary fallback={(e) => <p>出錯了:{e.message}</p>}>
          <Boom explode />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('外面的東西')).toBeInTheDocument()
    expect(screen.getByText('出錯了:壞掉的資料')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('reset() 清掉錯誤後重畫 children', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Harness() {
      const [explode, setExplode] = useState(true)
      return (
        <ErrorBoundary fallback={(_e, reset) => <button onClick={() => { setExplode(false); reset() }}>重試</button>}>
          <Boom explode={explode} />
        </ErrorBoundary>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '重試' }))
    expect(screen.getByText('正常內容')).toBeInTheDocument()
    spy.mockRestore()
  })
})
