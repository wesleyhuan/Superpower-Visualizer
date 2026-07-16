import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSessions } from '../src/sessions'

const jsonl = (recs: any[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n'

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

  it('root 不存在時回空陣列', () => {
    expect(listSessions(join(root, 'nope'))).toEqual([])
  })
})
