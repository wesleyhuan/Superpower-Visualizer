import { query } from '@anthropic-ai/claude-agent-sdk'
import { resolveWorkspace } from './agentAdapter'

// 一次性審查 query:不給工具(審查只需讀文字推理),串接 assistant 純文字後回傳。
// 與被觀察/被操控的 agent 是不同 session,故不會互相干擾。
export async function realAnalyzeQuery(prompt: string): Promise<string> {
  const abortController = new AbortController()
  const options: any = {
    cwd: resolveWorkspace(),
    abortController,
    maxTurns: 1,
    allowedTools: [], // 審查不需要動工具
  }
  console.log('[analyzeQuery] 送出審查 prompt,長度', prompt.length)
  let out = ''
  for await (const msg of query({ prompt, options }) as AsyncIterable<any>) {
    if (msg?.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block?.type === 'text') out += block.text
      }
    }
  }
  console.log('[analyzeQuery] 審查回覆完成,長度', out.length)
  return out
}
