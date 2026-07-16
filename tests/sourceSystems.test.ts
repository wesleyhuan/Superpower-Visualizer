import { describe, it, expect } from 'vitest'
import { makeObserveSource, workspaceFor } from '../src/sourceSystems'
import { AntigravitySource } from '../src/antigravitySource'
import { TranscriptSource } from '../src/transcriptSource'

describe('sourceSystems 分派', () => {
  it("system='antigravity' → AntigravitySource", () => {
    expect(makeObserveSource('antigravity', 'x.db', () => {})).toBeInstanceOf(AntigravitySource)
  })

  it("system='claude'(預設)→ TranscriptSource", () => {
    expect(makeObserveSource('claude', 'x.jsonl', () => {})).toBeInstanceOf(TranscriptSource)
  })

  it('workspaceFor:antigravity 檔不存在時回檔名本身(不 throw)', () => {
    expect(workspaceFor('antigravity', 'C:/nope/x.db')).toBe('C:/nope/x.db')
  })
})
