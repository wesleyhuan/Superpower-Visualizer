import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptSource } from '../src/transcriptSource'
import type { FrontendEvent } from '../src/types'

// 每筆記錄一行 JSON,寫成 .jsonl
const jsonl = (recs: any[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n'

let dir: string
let mainFile: string
let events: FrontendEvent[]
let src: TranscriptSource

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tail-'))
  mainFile = join(dir, 'sess.jsonl')
  events = []
})
afterEach(() => {
  src?.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('TranscriptSource backfill', () => {
  it('把 main 檔的對話與工具轉出來', () => {
    writeFileSync(mainFile, jsonl([
      { type: 'user', message: { content: '幫我看一下' } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: '好。' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] } },
    ]))
    src = new TranscriptSource(mainFile, (e) => events.push(...e))
    src.start()

    expect(events).toContainEqual({ kind: 'message', role: 'user', text: '幫我看一下' })
    // assistant 敘述現在是原始 assistant-text 事件(reason 配對在 assembler 做,不在 TranscriptSource)
    expect(events).toContainEqual({ kind: 'assistant-text', parentId: null, text: '好。' })
    expect(events).toContainEqual({ kind: 'tree:status', id: 't1', status: 'done' })
  })

  it('Agent tool_result(agentId)→ 追蹤 subagent 檔,其工具掛在該 Agent 節點下', () => {
    const agentId = 'abc123'
    writeFileSync(mainFile, jsonl([
      { type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'agentTool', name: 'Agent', input: { description: '研究' } },
      ] } },
      {
        type: 'user',
        toolUseResult: { agentId },
        message: { content: [{ type: 'tool_result', tool_use_id: 'agentTool', is_error: false, content: 'done' }] },
      },
    ]))
    const subDir = join(dir, 'sess', 'subagents')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, `agent-${agentId}.jsonl`), jsonl([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'subGrep', name: 'Grep', input: { pattern: 'x' } }] } },
    ]))

    src = new TranscriptSource(mainFile, (e) => events.push(...e))
    src.start() // backfill main → 發現連結 → 同一個 tick 內吃 subagent 檔

    // 主 Agent 節點
    expect(events).toContainEqual({
      kind: 'tree:node',
      node: { id: 'agentTool', parentId: null, type: 'subagent', label: 'subagent: 研究', status: 'running' },
    })
    // subagent 內的 Grep 掛在 agentTool 之下
    const sub = events.find((e) => e.kind === 'tree:node' && (e as any).node.id === 'subGrep') as any
    expect(sub.node.parentId).toBe('agentTool')
  })
})

describe('TranscriptSource 輪詢新增行', () => {
  it('start 後追加的行會被吃進來', async () => {
    writeFileSync(mainFile, jsonl([{ type: 'user', message: { content: '第一句' } }]))
    src = new TranscriptSource(mainFile, (e) => events.push(...e), 30)
    src.start()
    expect(events.some((e) => e.kind === 'message' && (e as any).text === '第一句')).toBe(true)

    // 追加一行(逐字稿是 append-only)
    writeFileSync(mainFile, jsonl([
      { type: 'user', message: { content: '第一句' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '第二句' }] } },
    ]))
    await new Promise((r) => setTimeout(r, 80))
    // 追加的是 assistant 敘述 → 原始 assistant-text 事件
    expect(events.some((e) => e.kind === 'assistant-text' && (e as any).text === '第二句')).toBe(true)
  })
})
