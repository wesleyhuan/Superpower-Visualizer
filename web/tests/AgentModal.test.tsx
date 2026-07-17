import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentModal } from '../src/components/AgentModal'
import type { AgentEntry } from '../src/buildAgentBlocks'
import type { TreeNode } from '../src/wireTypes'

const tool = (id: string, over: Partial<TreeNode> = {}): TreeNode =>
  ({ id, parentId: null, type: 'tool', label: id, status: 'done', ...over })

const entries: AgentEntry[] = [
  { key: 'main', title: '重構登入', kind: 'main', status: 'running', steps: 1,
    items: [tool('b', { label: 'Bash: ls', reason: '先看結構' })], subKeys: ['s1'] },
  { key: 's1', title: '研究結構', kind: 'sub', status: 'done', steps: 1,
    items: [tool('g', { label: 'Grep: auth', parentId: 's1' })], subKeys: [] },
]

function setup(index = 0) {
  const onIndex = vi.fn(); const onClose = vi.fn()
  render(<AgentModal entries={entries} index={index} outputByNode={{ b: '空目錄\n更多' }} onIndex={onIndex} onClose={onClose} />)
  return { onIndex, onClose }
}

describe('<AgentModal>', () => {
  it('顯示目前 agent 標題、位置 1/2、工作項目、reason、結果摘要', () => {
    setup(0)
    expect(screen.getByText('重構登入')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('Bash: ls')).toBeInTheDocument()
    expect(screen.getByText('先看結構')).toBeInTheDocument()
    expect(screen.getByText('空目錄')).toBeInTheDocument()
  })

  it('點 subagent chip → onIndex(1)', () => {
    const { onIndex } = setup(0)
    fireEvent.click(screen.getByText('研究結構')) // chip
    expect(onIndex).toHaveBeenCalledWith(1)
  })

  it('→ 下一個 → onIndex(1);第 0 個時 ← 停用', () => {
    const { onIndex } = setup(0)
    expect(screen.getByLabelText('上一個 agent')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('下一個 agent'))
    expect(onIndex).toHaveBeenCalledWith(1)
  })

  it('最後一個時 → 停用;← → onIndex(0)', () => {
    const { onIndex } = setup(1)
    expect(screen.getByLabelText('下一個 agent')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('上一個 agent'))
    expect(onIndex).toHaveBeenCalledWith(0)
  })

  it('鍵盤 → 切換,Esc / ✕ / scrim 關', () => {
    const { onIndex, onClose } = setup(0)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(onIndex).toHaveBeenCalledWith(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('關閉'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
