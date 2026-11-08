import { describe, it, expect } from 'vitest'
import { realAnalyzeQuery } from '../src/analyzeQuery'

// 假的 SDK query:吐出給定訊息;hang=true 時之後就一直等,直到收到 abort 才丟錯(模擬 SDK 行為)。
function fakeQuery(msgs: any[], hang = false) {
  return ({ options }: { prompt: string; options: any }) => ({
    async *[Symbol.asyncIterator]() {
      for (const m of msgs) yield m
      if (!hang) return
      const signal: AbortSignal = options.abortController.signal
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Operation aborted'))))
    },
  })
}

describe('realAnalyzeQuery', () => {
  it('串接 assistant 純文字並帶回模型 id', async () => {
    const q = fakeQuery([
      { type: 'assistant', message: { model: 'm-1', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] } },
      { type: 'result' },
    ])
    expect(await realAnalyzeQuery('p', { queryImpl: q })).toEqual({ text: '{"a":1}', model: 'm-1' })
  })

  it('超過時限就中止,丟出可讀的逾時錯誤', async () => {
    const q = fakeQuery([{ type: 'assistant', message: { content: [{ type: 'text', text: '{' }] } }], true)
    await expect(realAnalyzeQuery('p', { timeoutMs: 20, queryImpl: q })).rejects.toThrow('已中止')
  })

  it('串流在逾時後才安靜結束(不丟錯)也算逾時', async () => {
    const q = ({ options }: { prompt: string; options: any }) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise((r) => options.abortController.signal.addEventListener('abort', r))
      },
    })
    await expect(realAnalyzeQuery('p', { timeoutMs: 20, queryImpl: q })).rejects.toThrow('已中止')
  })
})
