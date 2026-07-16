import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentBlocks } from '../src/components/AgentBlocks'
import type { AgentBlock } from '../src/buildAgentBlocks'
import type { TreeNode } from '../src/wireTypes'

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode =>
  ({ id, parentId: null, type: 'tool', label: id, status: 'done', ...over })

describe('<AgentBlocks>', () => {
  it('渲染主 agent 標題、子 agent 區塊與工作項目', () => {
    const main: AgentBlock = {
      id: null, node: null, status: 'running',
      items: [node('Bash npm test', { label: 'Bash: npm test' })],
      children: [
        {
          id: 't', node: node('t', { type: 'subagent', label: '研究專案結構', status: 'running' }),
          status: 'running',
          items: [node('g', { label: 'Grep: auth' })],
          children: [],
        },
      ],
    }
    render(<AgentBlocks main={main} mainTitle="重構登入流程" />)
    expect(screen.getByText('重構登入流程')).toBeInTheDocument()
    expect(screen.getByText('研究專案結構')).toBeInTheDocument()
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument()
    expect(screen.getByText('Grep: auth')).toBeInTheDocument()
  })

  it('工具帶 reason 時,顯示「理由」那行;結果摘要取輸出第一行', () => {
    const main: AgentBlock = {
      id: null, node: null, status: 'done',
      items: [node('b', { label: 'Bash: ls', reason: '先看專案結構,確認是不是空的' })],
      children: [],
    }
    render(<AgentBlocks main={main} mainTitle="做西洋棋 App" outputByNode={{ b: '空目錄\n更多輸出…' }} />)
    expect(screen.getByText('先看專案結構,確認是不是空的')).toBeInTheDocument()
    expect(screen.getByText('空目錄')).toBeInTheDocument() // 結果摘要 = 第一行
  })

  it('subagent 的 reason(派它的理由)顯示在其區塊上方', () => {
    const main: AgentBlock = {
      id: null, node: null, status: 'running', items: [],
      children: [{ id: 't', node: node('t', { type: 'subagent', label: '實作棋盤', status: 'running', reason: '棋盤邏輯獨立,交給 subagent 做' }), status: 'running', items: [], children: [] }],
    }
    render(<AgentBlocks main={main} mainTitle="主任務" />)
    expect(screen.getByText('棋盤邏輯獨立,交給 subagent 做')).toBeInTheDocument()
  })

  it('subagent 區塊帶 data-status', () => {
    const main: AgentBlock = {
      id: null, node: null, status: 'awaiting', items: [],
      children: [{ id: 't', node: node('t', { type: 'subagent', label: '子任務', status: 'awaiting' }), status: 'awaiting', items: [], children: [] }],
    }
    render(<AgentBlocks main={main} mainTitle="主任務" />)
    expect(screen.getByText('子任務').closest('[data-status]')?.getAttribute('data-status')).toBe('awaiting')
  })
})
