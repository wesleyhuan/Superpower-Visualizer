import { query } from '@anthropic-ai/claude-agent-sdk'
import { resolveWorkspace } from './agentAdapter'

// 審查最多等多久。超過就中止,讓 UI 從「分析中…」回到可重試的狀態(之前會永遠卡住)。
export const ANALYZE_TIMEOUT_MS = 90_000

// 一次性審查 query:不給工具(審查只需讀文字推理),串接 assistant 純文字後回傳。
// 與被觀察/被操控的 agent 是不同 session,故不會互相干擾。
// timeoutMs / queryImpl 可注入,方便測試(不必真的呼叫 Agent SDK、也不必等 90 秒)。
export async function realAnalyzeQuery(
  prompt: string,
  { timeoutMs = ANALYZE_TIMEOUT_MS, queryImpl = query as (args: { prompt: string; options: any }) => AsyncIterable<any> } = {},
): Promise<{ text: string; model?: string }> {
  const abortController = new AbortController()
  // 計時器到點就 abort:SDK 收到 signal 會結束串流(可能丟錯,也可能靜靜收尾),兩種都在下面統一處理。
  const timer = setTimeout(() => abortController.abort(), timeoutMs)
  const options: any = {
    cwd: resolveWorkspace(),
    abortController,
    maxTurns: 1,
    allowedTools: [], // 審查不需要動工具
  }
  console.log('[analyzeQuery] 送出審查 prompt,長度', prompt.length)
  let out = ''
  let model: string | undefined
  const timeoutError = () => new Error(`審查超過 ${Math.round(timeoutMs / 1000)} 秒仍未完成,已中止`)
  try {
    for await (const msg of queryImpl({ prompt, options })) {
      if (abortController.signal.aborted) break
      if (msg?.type === 'assistant') {
        if (typeof msg.message?.model === 'string') model = msg.message.model // 記下實際審核模型
        for (const block of msg.message?.content ?? []) {
          if (block?.type === 'text') out += block.text
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) throw timeoutError()
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (abortController.signal.aborted) throw timeoutError()
  console.log('[analyzeQuery] 審查回覆完成,長度', out.length, '模型', model ?? '(未知)')
  return { text: out, model }
}
