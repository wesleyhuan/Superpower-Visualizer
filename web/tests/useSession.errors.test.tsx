import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSession } from '../src/useSession'

class FakeWS {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  readyState = 1
  static OPEN = 1
  constructor(public url: string) { FakeWS.last = this }
  send() {}
  close() { this.readyState = 3 }
  static last: FakeWS | null = null
}

const setup = (fetchImpl: unknown) => renderHook(() => useSession({
  WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl: fetchImpl as typeof fetch, wsUrl: 'ws://x',
}))

describe('useSession 錯誤處理', () => {
  it('POST 遇到網路錯誤 → notice 說明哪個動作失敗;dismissNotice 可關掉', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup(vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    act(() => result.current.start('hi'))
    await waitFor(() => expect(result.current.notice).toContain('啟動 agent失敗'))
    expect(result.current.notice).toContain('Failed to fetch')
    act(() => result.current.dismissNotice())
    expect(result.current.notice).toBeNull()
    spy.mockRestore()
  })

  it('POST 回 4xx/5xx → notice 帶後端給的 error 訊息', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'file not in allowed directory' }) })
    const { result } = setup(fetchImpl)
    act(() => result.current.observe('claude', '/etc/passwd'))
    await waitFor(() => expect(result.current.notice).toContain('切換觀察來源失敗'))
    expect(result.current.notice).toContain('file not in allowed directory')
    spy.mockRestore()
  })

  it('POST 成功 → 沒有 notice', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const { result } = setup(fetchImpl)
    await act(async () => { result.current.start('hi'); await Promise.resolve() })
    expect(fetchImpl).toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it('WebSocket 收到壞 JSON 或格式不符的訊息 → 忽略,不崩、狀態不變;之後的好訊息照常套用', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup(vi.fn().mockResolvedValue({ ok: true }))
    act(() => {
      FakeWS.last!.onmessage?.({ data: '{not json' })
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'event', seq: 1 }) })
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ hello: 'world' }) })
    })
    expect(result.current.state.seq).toBe(0)
    act(() => {
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'event', seq: 1, event: { kind: 'message', role: 'user', text: 'hi' } }) })
    })
    await waitFor(() => expect(result.current.state.messages).toHaveLength(1))
    spy.mockRestore()
  })

  it('/analyze 回傳形狀不對 → 正規化成 warn,不把壞資料交給畫面', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ verdict: 'ok', findings: 'nope' }) })
    const { result } = setup(fetchImpl)
    let got: any
    await act(async () => { got = await result.current.analyze({ title: 't', kind: 'main', steps: [] }) })
    expect(got).toEqual({ verdict: 'ok', summary: '(模型未提供總評)', findings: [] })
  })
})
