import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentModal } from '../src/components/AgentModal'
import type { AgentEntry } from '../src/buildAgentBlocks'
import type { TreeNode, AnalysisState } from '../src/wireTypes'

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
  render(<AgentModal entries={entries} index={index} outputByNode={{ b: '空目錄\n更多' }} analysisByKey={{}} onAnalyze={vi.fn()} onIndex={onIndex} onClose={onClose} />)
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

describe('AgentModal 合理性分析', () => {
  const entry: AgentEntry = {
    key: 'main', title: '重構登入', kind: 'main', status: 'done', steps: 2, items: [
      { id: 'a', parentId: null, type: 'tool', label: 'Grep: password', status: 'done', reason: '找雜湊' },
      { id: 'b', parentId: null, type: 'tool', label: 'Write: auth.ts', status: 'done' },
    ], subKeys: [],
  }
  const base = { entries: [entry], index: 0, outputByNode: {}, onIndex: vi.fn(), onClose: vi.fn() }

  it('未分析:顯示「分析合理性」按鈕;按下呼叫 onAnalyze 帶 key + trace', () => {
    const onAnalyze = vi.fn()
    render(<AgentModal {...base} analysisByKey={{}} onAnalyze={onAnalyze} />)
    fireEvent.click(screen.getByRole('button', { name: /分析合理性/ }))
    expect(onAnalyze).toHaveBeenCalledTimes(1)
    const [key, trace] = onAnalyze.mock.calls[0]
    expect(key).toBe('main')
    expect(trace.steps).toHaveLength(2)
  })

  it('loading:顯示分析中', () => {
    const st: AnalysisState = { status: 'loading' }
    render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(screen.getByText(/分析中/)).toBeInTheDocument()
  })

  it('done:判定徽章 + 總評帶 + 指摘就地掛在對應步驟下(嚴重度/分類/建議)', () => {
    const st: AnalysisState = { status: 'done', result: {
      verdict: 'warn', summary: '方向對但有缺口',
      findings: [{ severity: 'high', category: 'danger', step: 2, issue: '覆寫風險', suggestion: '先讀檔' }],
    } }
    const { container } = render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(screen.getByText('有疑慮')).toBeInTheDocument()          // 動作列徽章
    expect(screen.getByText('方向對但有缺口')).toBeInTheDocument()   // 判定帶總評
    expect(screen.getByText('覆寫風險')).toBeInTheDocument()
    expect(screen.getByText('先讀檔')).toBeInTheDocument()
    expect(screen.getByText('危險操作')).toBeInTheDocument()        // 分類標籤
    // 指摘就地掛在 step 2(第二個工作項目)之下,而不是頂部清單
    const step2 = container.querySelector('[data-step="2"]')!
    expect(step2.querySelector('.fin')).toBeTruthy()
    expect(step2.querySelector('.fin')!.textContent).toContain('覆寫風險')
  })

  it('done:健康條每步一格,被指摘的步驟帶嚴重度色', () => {
    const st: AnalysisState = { status: 'done', result: {
      verdict: 'bad', summary: 's',
      findings: [{ severity: 'high', category: 'danger', step: 2, issue: 'i', suggestion: 'x' }],
    } }
    const { container } = render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    const cells = container.querySelectorAll('.strip .cell')
    expect(cells).toHaveLength(2)                        // 2 步 → 2 格
    expect(cells[0].className).not.toContain('high')
    expect(cells[1].className).toContain('high')         // step 2 被指摘
  })

  it('done:整體性指摘(step 0)顯示在判定帶,不掛任何步驟', () => {
    const st: AnalysisState = { status: 'done', result: {
      verdict: 'warn', summary: '整體評語',
      findings: [{ severity: 'med', category: 'missing', step: 0, issue: '整體缺測試', suggestion: '補測試' }],
    } }
    const { container } = render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(container.querySelector('.vband')!.textContent).toContain('整體缺測試')
    // 沒有 step>0 指摘 → 不顯示健康條
    expect(container.querySelector('.strip')).toBeNull()
    // 也不會誤掛到任何工作項目
    expect(container.querySelector('.work .fin')).toBeNull()
  })

  it('done:超出步數範圍的 step → 歸入判定帶,不遺失、不誤掛', () => {
    const st: AnalysisState = { status: 'done', result: {
      verdict: 'bad', summary: 's',
      findings: [{ severity: 'high', category: 'danger', step: 99, issue: '越界指摘', suggestion: 'x' }],
    } }
    const { container } = render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(container.querySelector('.vband')!.textContent).toContain('越界指摘')  // 落在判定帶
    expect(container.querySelector('.strip')).toBeNull()                          // 對不到步 → 無健康條
    expect(container.querySelector('.work .fin')).toBeNull()                      // 不誤掛工作項目
  })

  it('done:無指摘(妥當)→ 有總評、無健康條、無指摘卡', () => {
    const st: AnalysisState = { status: 'done', result: { verdict: 'ok', summary: '一切妥當', findings: [] } }
    const { container } = render(<AgentModal {...base} analysisByKey={{ main: st }} onAnalyze={vi.fn()} />)
    expect(screen.getByText('一切妥當')).toBeInTheDocument()
    expect(container.querySelector('.strip')).toBeNull()
    expect(container.querySelector('.fin')).toBeNull()
  })

  it('空 items:分析按鈕停用', () => {
    const empty = { ...entry, items: [] }
    render(<AgentModal {...base} entries={[empty]} analysisByKey={{}} onAnalyze={vi.fn()} />)
    expect(screen.getByRole('button', { name: /分析合理性/ })).toBeDisabled()
  })
})
