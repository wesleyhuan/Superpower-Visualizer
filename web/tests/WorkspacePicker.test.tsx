import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WorkspacePicker } from '../src/components/WorkspacePicker'

const listingFor = (path: string): any => {
  if (path === 'C:/p') return { path: 'C:/p', parent: 'C:/', entries: ['sub'] }
  if (path === 'C:/p/sub') return { path: 'C:/p/sub', parent: 'C:/p', entries: [] }
  if (path === 'C:/') return { path: 'C:/', parent: '', entries: ['p'] }
  return { path, parent: 'C:/', entries: [] }
}

function setup(over: Partial<any> = {}) {
  const loadDirs = vi.fn((p: string) => Promise.resolve(listingFor(p)))
  const makeDir = vi.fn((parent: string, name: string) => Promise.resolve(`${parent}/${name}`))
  const onConfirm = vi.fn(); const onClose = vi.fn()
  render(<WorkspacePicker initialPath="C:/p" loadDirs={loadDirs} makeDir={makeDir} onConfirm={onConfirm} onClose={onClose} {...over} />)
  return { loadDirs, makeDir, onConfirm, onClose }
}

describe('WorkspacePicker', () => {
  it('載入 initialPath 顯示子資料夾', async () => {
    setup()
    expect(await screen.findByText('sub')).toBeInTheDocument()
  })

  it('點子資料夾 → 以新路徑 loadDirs', async () => {
    const { loadDirs } = setup()
    fireEvent.click(await screen.findByText('sub'))
    await waitFor(() => expect(loadDirs).toHaveBeenCalledWith('C:/p/sub'))
  })

  it('「使用這個目錄」→ onConfirm(目前 path)', async () => {
    const { onConfirm } = setup()
    await screen.findByText('sub')
    fireEvent.click(screen.getByRole('button', { name: /使用這個目錄/ }))
    expect(onConfirm).toHaveBeenCalledWith('C:/p')
  })

  it('建資料夾 → 呼叫 makeDir 並進入新目錄', async () => {
    const { makeDir, loadDirs } = setup()
    await screen.findByText('sub')
    fireEvent.change(screen.getByPlaceholderText(/新資料夾名稱/), { target: { value: 'proj' } })
    fireEvent.click(screen.getByRole('button', { name: /建立/ }))
    await waitFor(() => expect(makeDir).toHaveBeenCalledWith('C:/p', 'proj'))
    await waitFor(() => expect(loadDirs).toHaveBeenCalledWith('C:/p/proj'))
  })
})
