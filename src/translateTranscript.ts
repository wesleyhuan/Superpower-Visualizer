import type { FrontendEvent } from './types'
import { toolTypeOf, labelFor } from './translator'

// Route A:把 Claude Code 逐字稿(.jsonl)的「一筆記錄」轉成前端事件。
// 與 SDK 串流版 translate() 的差異:
//  - parentId 不在記錄裡,而是由呼叫端傳入(main 檔=null;subagent 檔=掛載的 tool_use id)。
//  - user 人類訊息是頂層字串 content;tool_result 則在 content 陣列裡。
export function translateTranscript(rec: any, parentId: string | null): FrontendEvent[] {
  const out: FrontendEvent[] = []
  if (!rec || typeof rec !== 'object') return out
  const content = rec.message?.content

  if (rec.type === 'user') {
    // 人類輸入:content 是字串。isMeta/系統注入的不算對話。
    if (typeof content === 'string') {
      const t = content.trim()
      if (t && !rec.isMeta) out.push({ kind: 'message', role: 'user', text: t })
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'tool_result') {
          const isError = !!b.is_error
          out.push({ kind: 'tree:status', id: b.tool_use_id, status: isError ? 'error' : 'done' })
          out.push({
            kind: 'log',
            entry: {
              ts: Date.now(),
              nodeId: b.tool_use_id,
              text: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
              level: isError ? 'error' : 'info',
            },
          })
        }
      }
    }
  }

  if (rec.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') {
        // 敘述交給 ReActAssembler(見 translator.ts)。
        out.push({ kind: 'assistant-text', parentId, text: b.text.trim() })
      }
      if (b?.type === 'tool_use') {
        const type = toolTypeOf(b.name)
        const label = labelFor(b.name, b.input)
        out.push({ kind: 'tree:node', node: { id: b.id, parentId, type, label, status: 'running' } })
        // 見 translator.ts:tool_use 不補 log,結果摘要/展開輸出只吃 tool_result 的實際輸出。
      }
    }
  }

  return out
}
