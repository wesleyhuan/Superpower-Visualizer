import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSessions, firstMeta } from '../src/sessions'

const jsonl = (recs: any[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n'

function writeSession(recs: any[]): string {
  const proj = mkdtempSync(join(tmpdir(), 'sess-'))
  const f = join(proj, 's.jsonl')
  writeFileSync(f, jsonl(recs))
  return f
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'proj-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('listSessions', () => {
  it('列出各專案下的 session 主檔,帶 cwd 與 subagent 數,排除 subagents 子檔', () => {
    const projA = join(root, 'C--Users-me-app')
    mkdirSync(projA, { recursive: true })
    writeFileSync(join(projA, 's1.jsonl'), jsonl([{ type: 'user', cwd: 'C:/Users/me/app', message: { content: 'hi' } }]))
    // s1 的 subagents 子檔:不可被當成獨立 session
    const sub = join(projA, 's1', 'subagents')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'agent-x.jsonl'), jsonl([{ type: 'assistant', message: { content: [] } }]))
    writeFileSync(join(sub, 'agent-y.jsonl'), jsonl([{ type: 'assistant', message: { content: [] } }]))

    const list = listSessions(root)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ file: join(projA, 's1.jsonl'), project: 'C--Users-me-app', cwd: 'C:/Users/me/app', subagents: 2 })
    expect(typeof list[0].mtime).toBe('number')
  })

  it('多個 session 依修改時間新到舊排序', () => {
    const proj = join(root, 'p')
    mkdirSync(proj, { recursive: true })
    const older = join(proj, 'old.jsonl')
    const newer = join(proj, 'new.jsonl')
    writeFileSync(older, jsonl([{ type: 'user', cwd: 'x', message: { content: 'a' } }]))
    writeFileSync(newer, jsonl([{ type: 'user', cwd: 'x', message: { content: 'b' } }]))
    // 明確設定 mtime:older 較舊
    const { utimesSync } = require('node:fs')
    utimesSync(older, new Date(1000), new Date(1000))
    utimesSync(newer, new Date(2000), new Date(2000))

    const list = listSessions(root)
    expect(list.map((s) => s.file)).toEqual([newer, older])
  })

  it('帶入 title:第一句 user 訊息', () => {
    const projA = join(root, 'C--Users-me-app')
    mkdirSync(projA, { recursive: true })
    writeFileSync(join(projA, 's1.jsonl'), jsonl([
      { type: 'system' },
      { type: 'user', cwd: 'C:/Users/me/app', message: { role: 'user', content: '幫我製作一個計算機APP' } },
    ]))
    const list = listSessions(root)
    expect(list[0].title).toBe('幫我製作一個計算機APP')
  })
})

describe('firstMeta', () => {
  it('抽出 cwd 與第一句 user 訊息當 title', () => {
    const f = writeSession([
      { type: 'system', cwd: 'C:/proj' },
      { type: 'user', message: { role: 'user', content: '幫我重構登入流程' } },
    ])
    expect(firstMeta(f)).toEqual({ cwd: 'C:/proj', title: '幫我重構登入流程' })
  })

  it('content 為區塊陣列時串接 text 區塊', () => {
    const f = writeSession([
      { type: 'user', cwd: 'x', message: { role: 'user', content: [{ type: 'text', text: '你好' }, { type: 'image' }] } },
    ])
    expect(firstMeta(f).title).toBe('你好')
  })

  it('slash 指令:清成乾淨的 /xxx(取 command-name)', () => {
    const f = writeSession([
      { type: 'user', cwd: 'x', message: { role: 'user', content: '<command-message>init</command-message> <command-name>/init</command-name>' } },
    ])
    expect(firstMeta(f).title).toBe('/init')
  })

  it('跳過沒有文字的 user 訊息(tool_result),取下一筆有文字的', () => {
    const f = writeSession([
      { type: 'user', cwd: 'x', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'user', message: { role: 'user', content: '真正的問題' } },
    ])
    expect(firstMeta(f).title).toBe('真正的問題')
  })

  it('抽不到 user 文字時 title 為空字串', () => {
    const f = writeSession([{ type: 'system', cwd: 'x' }])
    expect(firstMeta(f)).toEqual({ cwd: 'x', title: '' })
  })
})
