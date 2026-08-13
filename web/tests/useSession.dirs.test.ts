import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../src/useSession'

class FakeWS {
  onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onclose: (() => void) | null = null
  readyState = 1; static OPEN = 1
  constructor(public url: string) {}
  send() {} close() {}
}
const mk = (fetchImpl: any) => renderHook(() => useSession({
  WebSocketImpl: FakeWS as unknown as typeof WebSocket, fetchImpl, wsUrl: 'ws://x',
}))

describe('useSession 目錄 API', () => {
  it('newAgent(cwd) → POST /new-agent { cwd }', () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const { result } = mk(fetchImpl)
    act(() => result.current.newAgent('C:/work'))
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/new-agent')
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ cwd: 'C:/work' })
  })

  it('newAgent() 無 cwd → POST /new-agent {}', () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const { result } = mk(fetchImpl)
    act(() => result.current.newAgent())
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/new-agent')
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({})
  })

  it('loadDirs(path) → GET /dirs?path=… 回 listing', async () => {
    const listing = { path: 'C:/p', parent: 'C:/', entries: ['a'] }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(listing) })
    const { result } = mk(fetchImpl)
    let got: any
    await act(async () => { got = await result.current.loadDirs('C:/p') })
    expect(got).toEqual(listing)
    // 驗完整、且經過 encodeURIComponent 的 URL(C:/p → C%3A%2Fp)
    const call = fetchImpl.mock.calls.find((c) => String(c[0]).startsWith('/dirs?'))
    expect(call![0]).toBe(`/dirs?path=${encodeURIComponent('C:/p')}`)
  })

  it('makeDir(parent,name) → POST /mkdir 回新路徑', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ path: 'C:/p/new' }) })
    const { result } = mk(fetchImpl)
    let got: any
    await act(async () => { got = await result.current.makeDir('C:/p', 'new') })
    expect(got).toBe('C:/p/new')
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/mkdir')
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ parent: 'C:/p', name: 'new' })
  })
})
