import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '../src/useSession'

class FakeWS {
  onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onclose: (() => void) | null = null
  readyState = 1; static OPEN = 1
  constructor(public url: string) {}
  send() {} close() {}
}

describe('useSession.analyze', () => {
  it('POST /analyze 帶 { trace },回傳解析後的 AnalysisResult', async () => {
    const result = { verdict: 'warn', summary: 's', findings: [] }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(result) })
    const { result: hook } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      fetchImpl: fetchImpl as unknown as typeof fetch, wsUrl: 'ws://x',
    }))
    const trace = { title: 't', kind: 'main' as const, steps: [] }
    let got: any
    await act(async () => { got = await hook.current.analyze(trace) })
    expect(got).toEqual(result)
    const call = fetchImpl.mock.calls.find((c) => c[0] === '/analyze')
    expect(call).toBeTruthy()
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ trace })
  })

  it('fetch 失敗 → warn fallback,不拋出', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('網路掛了'))
    const { result: hook } = renderHook(() => useSession({
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      fetchImpl: fetchImpl as unknown as typeof fetch, wsUrl: 'ws://x',
    }))
    let got: any
    await act(async () => { got = await hook.current.analyze({ title: 't', kind: 'main', steps: [] }) })
    expect(got.verdict).toBe('warn')
    expect(got.summary).toContain('網路掛了')
  })
})
