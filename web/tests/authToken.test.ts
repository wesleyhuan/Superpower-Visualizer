import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readAuthToken, withToken } from '../src/authToken'
import { useSession } from '../src/useSession'

describe('readAuthToken', () => {
  beforeEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/') })

  it('網址有 ?token= → 回傳、存進 sessionStorage、並從網址列移除(保留其他參數)', () => {
    history.replaceState(null, '', '/?token=abc&x=1#h')
    expect(readAuthToken()).toBe('abc')
    expect(sessionStorage.getItem('sv-token')).toBe('abc')
    expect(location.search).toBe('?x=1')
    expect(location.hash).toBe('#h')
  })

  it('網址沒有 → 用 sessionStorage 裡的(重新整理後還能用)', () => {
    sessionStorage.setItem('sv-token', 'saved')
    expect(readAuthToken()).toBe('saved')
  })

  it('都沒有 → null', () => {
    expect(readAuthToken()).toBe(null)
  })
})

describe('withToken', () => {
  it('把 token 接到 WS 網址', () => {
    expect(withToken('ws://localhost:3001', 'a b')).toBe('ws://localhost:3001?token=a%20b')
    expect(withToken('ws://x?y=1', 't')).toBe('ws://x?y=1&token=t')
    expect(withToken('ws://x', null)).toBe('ws://x')
  })
})

describe('useSession 帶 token', () => {
  class FakeWS {
    static last: FakeWS | null = null
    onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onclose: (() => void) | null = null
    readyState = 1; static OPEN = 1
    constructor(public url: string) { FakeWS.last = this }
    send() {} close() {}
  }

  it('WS 網址帶 ?token=,HTTP 請求帶 x-sv-token header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sessions: [] }) })
    const { result } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl: fetchImpl as unknown as typeof fetch,
      wsUrl: 'ws://x', token: 'secret',
    }))
    expect(FakeWS.last!.url).toBe('ws://x?token=secret')
    expect(result.current.hasToken).toBe(true)

    act(() => result.current.start('hi'))
    const startCall = fetchImpl.mock.calls.find((c) => c[0] === '/start')!
    expect((startCall[1] as RequestInit).headers).toEqual({ 'content-type': 'application/json', 'x-sv-token': 'secret' })

    await act(async () => { await result.current.loadSessions('claude') })
    const getCall = fetchImpl.mock.calls.find((c) => String(c[0]).startsWith('/sessions'))!
    expect((getCall[1] as RequestInit).headers).toEqual({ 'x-sv-token': 'secret' })
  })

  it('沒有 token → hasToken=false(畫面會提示用正確網址開啟)', () => {
    const { result } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl: vi.fn() as unknown as typeof fetch,
      wsUrl: 'ws://x', token: null,
    }))
    expect(result.current.hasToken).toBe(false)
    expect(FakeWS.last!.url).toBe('ws://x')
  })
})
