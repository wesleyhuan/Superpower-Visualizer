import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { splitSessions, shortProject, SourcePicker } from '../src/components/SourcePicker'
import type { SessionInfo } from '../src/wireTypes'

const claude = (title: string, trivial: boolean): SessionInfo =>
  ({ system: 'claude', file: title, project: 'p', cwd: 'x', title, mtime: 0, subagents: 0, trivial })
const anti = (identity: string): SessionInfo =>
  ({ system: 'antigravity', file: identity, identity, cwd: 'x', mtime: 0, steps: 1 })

describe('shortProject', () => {
  it('有 cwd 時取真實路徑最後一段(Windows)', () => {
    expect(shortProject('C--Users-wesle-Desktop-proj-chess', 'C:\\Users\\wesle\\Desktop\\proj-chess')).toBe('proj-chess')
  })
  it('有 cwd 時取真實路徑最後一段(Unix,含結尾斜線)', () => {
    expect(shortProject('-Users-alice-proj', '/Users/alice/proj/')).toBe('proj')
  })
  it('無 cwd:C 槽 Desktop slug 去前綴', () => {
    expect(shortProject('C--Users-wesle-Desktop-proj-chess')).toBe('proj/chess')
  })
  it('無 cwd:D 槽 slug 不留雙斜線', () => {
    expect(shortProject('D--proj-app')).toBe('proj/app')
  })
  it('無 cwd:Mac slug 去家目錄前綴', () => {
    expect(shortProject('-Users-alice-proj')).toBe('proj')
  })
})

describe('splitSessions', () => {
  it('依 trivial 拆成 normal / trivial', () => {
    const list = [claude('real', false), claude('/model', true), claude('/init', true)]
    const { normal, trivial } = splitSessions(list)
    expect(normal.map((s) => (s as any).title)).toEqual(['real'])
    expect(trivial.map((s) => (s as any).title)).toEqual(['/model', '/init'])
  })
  it('Antigravity session 一律歸 normal', () => {
    const { normal, trivial } = splitSessions([anti('orchestrator')])
    expect(normal).toHaveLength(1)
    expect(trivial).toHaveLength(0)
  })
})

function openClaudeList(list: SessionInfo[]) {
  const loadSessions = vi.fn(() => Promise.resolve(list))
  render(<SourcePicker mode="control" onObserve={vi.fn()} onNewAgent={vi.fn()} loadSessions={loadSessions} />)
  fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
  fireEvent.click(screen.getByText(/觀察 Claude session/))
  return loadSessions
}

describe('SourcePicker 瑣碎摺疊', () => {
  const list: SessionInfo[] = [
    { system: 'claude', file: 'r', project: 'p', cwd: 'x', title: '真實任務', mtime: 0, subagents: 0, trivial: false },
    { system: 'claude', file: 'm', project: 'p', cwd: 'x', title: '/model', mtime: 0, subagents: 0, trivial: true },
  ]

  it('預設顯示正常項、隱藏瑣碎項,toggle 帶數量', async () => {
    openClaudeList(list)
    expect(await screen.findByText('真實任務')).toBeInTheDocument()
    expect(screen.queryByText('/model')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /瑣碎 session \(1\)/ })).toBeInTheDocument()
  })

  it('點 toggle 後顯示瑣碎項', async () => {
    openClaudeList(list)
    await screen.findByText('真實任務')
    fireEvent.click(screen.getByRole('button', { name: /瑣碎 session \(1\)/ }))
    expect(screen.getByText('/model')).toBeInTheDocument()
  })

  it('沒有瑣碎項時不顯示 toggle', async () => {
    openClaudeList([list[0]])
    await screen.findByText('真實任務')
    expect(screen.queryByText(/瑣碎 session/)).not.toBeInTheDocument()
  })
})
