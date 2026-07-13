type Decision =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; message: string }
type CanUseTool = (toolName: string, input: unknown, ctx: { toolUseId: string }) => Promise<Decision>
type RunQuery = (args: {
  prompt: AsyncIterable<any>
  canUseTool: CanUseTool
  signal: AbortSignal
}) => AsyncIterable<any>

export class SessionManager {
  private pending = new Map<string, (d: Decision) => void>()
  private msgCbs: ((m: any) => void)[] = []
  private awaitCbs: ((a: { toolUseId: string; name: string; input: unknown }) => void)[] = []
  private controller = new AbortController()

  constructor(private deps: { runQuery: RunQuery }) {}

  onMessage(cb: (m: any) => void) { this.msgCbs.push(cb) }
  onAwaitTool(cb: (a: { toolUseId: string; name: string; input: unknown }) => void) { this.awaitCbs.push(cb) }

  private canUseTool: CanUseTool = (toolName, input, ctx) => {
    console.log('[SessionManager] canUseTool gate', toolName, ctx.toolUseId)
    return new Promise<Decision>((resolve) => {
      this.pending.set(ctx.toolUseId, resolve)
      for (const cb of this.awaitCbs) cb({ toolUseId: ctx.toolUseId, name: toolName, input })
    })
  }

  approveTool(toolUseId: string, allow: boolean) {
    const resolve = this.pending.get(toolUseId)
    if (!resolve) { console.log('[SessionManager] approve no-op, unknown', toolUseId); return }
    this.pending.delete(toolUseId)
    resolve(allow ? { behavior: 'allow', updatedInput: undefined } : { behavior: 'deny', message: 'user denied' })
  }

  start(initialPrompt: string) {
    void this.consume(initialPrompt)
  }

  private async *inputGen(initialPrompt: string): AsyncIterable<any> {
    yield { type: 'user', message: { role: 'user', content: initialPrompt } }
  }

  private async consume(initialPrompt: string) {
    try {
      const stream = this.deps.runQuery({
        prompt: this.inputGen(initialPrompt),
        canUseTool: this.canUseTool,
        signal: this.controller.signal,
      })
      for await (const msg of stream) {
        for (const cb of this.msgCbs) cb(msg)
      }
    } catch (err) {
      console.error('[SessionManager] consume error:', err)
      for (const cb of this.msgCbs) cb({ type: 'session_error', error: String(err) })
    }
  }
}
