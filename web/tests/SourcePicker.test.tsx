import { describe, it, expect } from 'vitest'
import { splitSessions } from '../src/components/SourcePicker'
import type { SessionInfo } from '../src/wireTypes'

const claude = (title: string, trivial: boolean): SessionInfo =>
  ({ system: 'claude', file: title, project: 'p', cwd: 'x', title, mtime: 0, subagents: 0, trivial })
const anti = (identity: string): SessionInfo =>
  ({ system: 'antigravity', file: identity, identity, cwd: 'x', mtime: 0, steps: 1 })

describe('splitSessions', () => {
  it('依 trivial 拆成 normal / trivial', () => {
    const list = [claude('real', false), claude('/model', true), claude('/init', true)]
    const { normal, trivial } = splitSessions(list)
    expect(normal.map((s) => (s as any).title)).toEqual(['real'])
    expect(trivial.map((s) => (s as any).title)).toEqual(['/model', '/init'])
  })
  it('Antigravity session 一律歸 normal', () => {
    const { normal, trivial } = splitSessions([anti('orchestrator')])
    expect(normal).toHaveLength(1)
    expect(trivial).toHaveLength(0)
  })
})
