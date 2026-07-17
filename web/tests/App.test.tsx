import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { App } from '../src/App'

// 假 WebSocket:可手動觸發 onopen / onmessage
class FakeWS {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = 1
  static OPEN = 1
  sent: string[] = []
  constructor(public url: string) { FakeWS.last = this }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  static last: FakeWS | null = null
}

let fetchImpl: ReturnType<typeof vi.fn>

function push(data: unknown) {
  act(() => { FakeWS.last!.onmessage?.({ data: JSON.stringify(data) }) })
}
const snapshot = (over: Record<string, unknown> = {}) =>
  ({ type: 'snapshot', seq: 0, nodes: [], logs: [], messages: [], workspace: '', ...over })

function renderApp() {
  render(<App deps={{ WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl: fetchImpl as unknown as typeof fetch, wsUrl: 'ws://x' }} />)
  act(() => { FakeWS.last!.onopen?.() })
}
function bodyOf(path: string) {
  const call = fetchImpl.mock.calls.find((c) => c[0] === path)
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

describe('App 整合流程(假 WebSocket 驅動)', () => {
  beforeEach(() => {
    FakeWS.last = null
    fetchImpl = vi.fn().mockResolvedValue({ ok: true })
  })

  it('未啟動時輸入任務按送出 → POST /start 帶 prompt', () => {
    renderApp()
    push(snapshot())
    fireEvent.change(screen.getByPlaceholderText(/初始任務/), { target: { value: '重構登入' } })
    fireEvent.click(screen.getByRole('button', { name: /送出/ }))
    expect(bodyOf('/start')).toEqual({ prompt: '重構登入' })
  })

  it('await:tool → 跳出核准 modal;按核准 → POST /control approve 且 modal 關閉', async () => {
    renderApp()
    push(snapshot())
    push({ type: 'event', seq: 1, event: { kind: 'tree:node', node: { id: 'toolu_1', parentId: null, type: 'tool', label: 'Write: a.ts', status: 'running' } } })
    push({ type: 'event', seq: 2, event: { kind: 'await:tool', toolUseId: 'toolu_1', name: 'Write', input: { file_path: 'a.ts' } } })

    expect(await screen.findByText('等待你核准')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '核准' }))

    expect(bodyOf('/control')).toEqual({ type: 'approve', toolUseId: 'toolu_1', allow: true })
    await waitFor(() => expect(screen.queryByText('等待你核准')).toBeNull()) // 樂觀移除 → 關閉
  })

  it('已啟動後送出 → POST /control followup', () => {
    renderApp()
    push(snapshot({ messages: [{ role: 'user', text: '第一個任務' }] }))
    fireEvent.change(screen.getByPlaceholderText(/派新任務/), { target: { value: '再做一件事' } })
    fireEvent.click(screen.getByRole('button', { name: /送出/ }))
    expect(bodyOf('/control')).toEqual({ type: 'followup', text: '再做一件事' })
  })

  it('暫停鈕 → POST /control pause', () => {
    renderApp()
    push(snapshot({ messages: [{ role: 'user', text: 'x' }] }))
    fireEvent.click(screen.getByRole('button', { name: '暫停 agent' }))
    expect(bodyOf('/control')).toEqual({ type: 'pause' })
  })

  it('observe 模式:輸入框唯讀、隱藏暫停鈕、送出停用', () => {
    renderApp()
    push(snapshot({ mode: 'observe', workspace: 'C:/other/proj', messages: [{ role: 'user', text: '外部任務' }] }))
    expect(screen.getByPlaceholderText(/觀察中/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: '暫停 agent' })).toBeNull()
    expect(screen.getByRole('button', { name: /送出/ })).toBeDisabled()
  })

  it('來源下拉:先選 Claude → 載入 sessions → 點某個 → POST /observe;點新 Agent → POST /new-agent', async () => {
    fetchImpl = vi.fn((path: string) => {
      if (path.startsWith('/sessions')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessions: [
        { system: 'claude', file: 'C:/proj/s.jsonl', project: 'C--Users-me-Desktop-proj-chess', cwd: 'C:/proj', mtime: Date.now(), subagents: 3 },
      ] }) })
      return Promise.resolve({ ok: true })
    }) as unknown as typeof fetchImpl
    renderApp()
    push(snapshot())

    fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
    fireEvent.click(screen.getByText(/觀察 Claude session/))
    const item = await screen.findByText('proj/chess')
    fireEvent.click(item)
    expect(bodyOf('/observe')).toEqual({ system: 'claude', file: 'C:/proj/s.jsonl' })

    fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
    fireEvent.click(await screen.findByText(/新 Agent/))
    expect(bodyOf('/new-agent')).toEqual({})
  })

  it('來源下拉:選 Antigravity → 帶 system 載入 → 點對話(顯示 identity)→ POST /observe 帶 system', async () => {
    fetchImpl = vi.fn((path: string) => {
      if (path.startsWith('/sessions')) {
        expect(path).toBe('/sessions?system=antigravity') // 帶 system query
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessions: [
          { system: 'antigravity', file: 'C:/ag/conv1.db', identity: 'teamwork_preview_orchestrator', cwd: 'C:/ag', mtime: Date.now(), steps: 173 },
        ] }) })
      }
      return Promise.resolve({ ok: true })
    }) as unknown as typeof fetchImpl
    renderApp()
    push(snapshot())

    fireEvent.click(screen.getByRole('button', { name: /切換來源/ }))
    fireEvent.click(screen.getByText(/觀察 Antigravity 對話/))
    const item = await screen.findByText('teamwork_preview_orchestrator')
    fireEvent.click(item)
    expect(bodyOf('/observe')).toEqual({ system: 'antigravity', file: 'C:/ag/conv1.db' })
  })

  it('事件流:對話即時顯示,agent 清單點開後彈窗顯示工作項目', async () => {
    renderApp()
    push(snapshot())
    push({ type: 'event', seq: 1, event: { kind: 'message', role: 'user', text: '幫我做計算機' } })
    push({ type: 'event', seq: 2, event: { kind: 'message', role: 'assistant', text: '好的,我開始。' } })
    push({ type: 'event', seq: 3, event: { kind: 'tree:node', node: { id: 'b', parentId: null, type: 'tool', label: 'Bash: ls', status: 'done' } } })

    // 使用者訊息同時出現在對話 bubble 與左側 agent 清單列標題
    expect((await screen.findAllByText('幫我做計算機')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('好的,我開始。')).toBeInTheDocument()   // agent 文字回覆(對話)

    // 工作項目在彈窗裡:點 agent 列開窗後才出現
    expect(screen.queryByText('Bash: ls')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /幫我做計算機/ }))
    expect(screen.getByText('Bash: ls')).toBeInTheDocument()
  })
})
