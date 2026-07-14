import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveWorkspace, buildOptions } from '../src/agentAdapter'

afterEach(() => { delete process.env.AGENT_WORKSPACE })

describe('resolveWorkspace', () => {
  it('預設回傳 process.cwd()', () => {
    expect(resolveWorkspace()).toBe(process.cwd())
  })
  it('有 AGENT_WORKSPACE 時以它為準(去空白)', () => {
    process.env.AGENT_WORKSPACE = '  D:\\proj  '
    expect(resolveWorkspace()).toBe('D:\\proj')
  })
  it('AGENT_WORKSPACE 為空字串時退回 process.cwd()', () => {
    process.env.AGENT_WORKSPACE = '   '
    expect(resolveWorkspace()).toBe(process.cwd())
  })
})

describe('buildOptions', () => {
  it('把 cwd 明確設進 options,並橋接 abortController', () => {
    const ac = new AbortController()
    const opts = buildOptions(async () => ({ behavior: 'allow', updatedInput: undefined }), ac)
    expect(opts.cwd).toBe(process.cwd())
    expect(opts.abortController).toBe(ac)
    expect(typeof opts.canUseTool).toBe('function')
  })

  it('canUseTool 用 opts.toolUseID(大寫)當 toolUseId 傳給下游', async () => {
    const spy = vi.fn(async () => ({ behavior: 'allow' as const, updatedInput: undefined }))
    const opts = buildOptions(spy, new AbortController())
    await opts.canUseTool('Write', { file_path: 'x' }, { toolUseID: 'toolu_ABC' })
    expect(spy).toHaveBeenCalledWith('Write', { file_path: 'x' }, { toolUseId: 'toolu_ABC' })
  })
})
