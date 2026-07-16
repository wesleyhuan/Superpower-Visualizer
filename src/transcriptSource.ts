import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { FrontendEvent } from './types'
import { translateTranscript } from './translateTranscript'
import { firstCwd } from './sessions'

// Route A tailer:輪詢一個「正在跑」的 Claude Code session 逐字稿(main + subagents/),
// 把新增的行轉成 FrontendEvent 餵給 emit()。純觀察、唯讀。
//
// 連結機制(見 spike):main 檔的 Agent tool_result 帶 toolUseResult.agentId,
// 對應到 subagents/agent-<agentId>.jsonl;該子檔內的工具就掛在這個 Agent tool_use 節點下。
export class TranscriptSource {
  private readonly subDir: string
  private linesConsumed = new Map<string, number>() // 每個檔已處理到第幾行(只吃完整的行)
  private tracked = new Map<string, string | null>() // file → parentId(main 為 null)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly mainFile: string,
    private readonly emit: (events: FrontendEvent[]) => void,
    private readonly pollMs = 400,
  ) {
    this.subDir = join(dirname(mainFile), basename(mainFile, '.jsonl'), 'subagents')
    this.tracked.set(mainFile, null)
  }

  /** 先把現有內容補齊(backfill),再開始輪詢新增行。 */
  start(): void {
    console.log(`[tail] 開始追蹤:${this.mainFile}`)
    console.log(`[tail] subagents 目錄:${this.subDir}(${existsSync(this.subDir) ? '存在' : '尚無'})`)
    this.tick()
    this.timer = setInterval(() => this.tick(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    // 反覆掃到不再有新行為止:main 先跑會發現 subagent 對應並加入 tracked,
    // 同一個 tick 內就要把新登記的子檔也吃掉(否則 backfill 會漏一層)。
    let progressed = true
    while (progressed) {
      progressed = false
      for (const [file, parentId] of [...this.tracked]) {
        if (this.consumeNewLines(file, parentId)) progressed = true
      }
    }
  }

  private consumeNewLines(file: string, parentId: string | null): boolean {
    if (!existsSync(file)) return false
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (err) {
      console.error(`[tail] 讀取失敗 ${file}:`, err)
      return false
    }
    // 只處理完整的行:最後一段(不論是否為空)當作可能未寫完,留到下次。
    const parts = text.split('\n')
    const complete = parts.slice(0, -1)
    const from = this.linesConsumed.get(file) ?? 0
    if (complete.length <= from) return false

    for (let i = from; i < complete.length; i++) {
      const line = complete[i]
      if (!line.trim()) continue
      let rec: any
      try {
        rec = JSON.parse(line)
      } catch (err) {
        console.error(`[tail] JSON 解析失敗(${basename(file)} 第 ${i} 行):`, err)
        continue
      }
      this.emit(translateTranscript(rec, parentId))
      this.linkSubagent(rec) // 發現 Agent→子檔對應時,開始追蹤該子檔
    }
    this.linesConsumed.set(file, complete.length)
    return true
  }

  // 若這筆是 Agent 的 tool_result(帶 agentId),就把對應的 subagent 檔加入追蹤,
  // 掛在該 tool_use 節點下。
  private linkSubagent(rec: any): void {
    const agentId = rec?.toolUseResult?.agentId
    if (!agentId) return
    const content = rec.message?.content
    const tid = Array.isArray(content)
      ? content.find((b: any) => b?.type === 'tool_result')?.tool_use_id
      : undefined
    if (!tid) return
    const file = join(this.subDir, `agent-${agentId}.jsonl`)
    if (this.tracked.has(file)) return
    this.tracked.set(file, tid) // 掛在 Agent tool_use 節點(tid)下;不存在也先登記,之後出現就會被吃
    console.log(`[tail] 連結 subagent:agent-${agentId} → 掛在 ${tid}`)
  }
}

// session 的工作目錄(顯示在 UI 標題列):取逐字稿的 cwd,讀不到就回檔名。
export function readWorkspace(file: string): string {
  return firstCwd(file) || file
}

// 自動挑選最近修改的 session 檔(排除 subagents/ 內的子檔)。
export function pickLatestSession(root = join(homedir(), '.claude', 'projects')): string | null {
  if (!existsSync(root)) {
    console.error(`[tail] 找不到 ${root}`)
    return null
  }
  let best: { file: string; mtime: number } | null = null
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        if (name === 'subagents') continue // 子檔不算獨立 session
        walk(p)
      } else if (name.endsWith('.jsonl')) {
        if (!best || st.mtimeMs > best.mtime) best = { file: p, mtime: st.mtimeMs }
      }
    }
  }
  try {
    walk(root)
  } catch (err) {
    console.error('[tail] 掃描 session 失敗:', err)
  }
  return best?.file ?? null
}
