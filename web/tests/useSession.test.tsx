import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSession } from '../src/useSession'

// 極簡假 WebSocket:可手動觸發 onopen / onmessage
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

describe('useSession', () => {
  it('收到 snapshot 後更新 state;approve 會 POST /control 並樂觀移除 pending', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as any
    const { result } = renderHook(() =>
      useSession({ WebSocketImpl: FakeWS as any, fetchImpl, wsUrl: 'ws://x' }))

    act(() => { FakeWS.last!.onopen?.() })
    await waitFor(() => expect(result.current.connected).toBe(true))

    // 推一個帶 pending 的事件序列
    act(() => {
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'snapshot', seq: 0, nodes: [], logs: [] }) })
      FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'event', seq: 1, event: { kind: 'await:tool', toolUseId: 't1', name: 'Bash', input: {} } }) })
    })
    await waitFor(() => expect(result.current.state.pending).toHaveLength(1))

    act(() => { result.current.approve('t1', true) })
    expect(fetchImpl).toHaveBeenCalledWith('/control', expect.objectContaining({ method: 'POST' }))
    await waitFor(() => expect(result.current.state.pending).toHaveLength(0))
  })
})
