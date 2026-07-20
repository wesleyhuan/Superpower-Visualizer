import { existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ANALYSIS_PROMPT_OPENING } from './analyze'

export interface SessionInfo {
  file: string      // 主 .jsonl 絕對路徑
  project: string   // 專案資料夾名(slug)
  cwd: string       // 該 session 的工作目錄(取自逐字稿第一筆)
  title: string     // 該對話的第一句 user 訊息(清掉指令標籤);抽不到為空字串
  mtime: number     // 最後修改時間(ms)
  subagents: number // subagents/ 內的子檔數
}

// 列出 ~/.claude/projects 下所有「可觀察」的 session 主檔(排除 subagents/ 內的子檔),
// 依修改時間新到舊排序。輕量:只 stat + 讀第一行取 cwd + 數子檔,不解析整份逐字稿。
export function listSessions(root = join(homedir(), '.claude', 'projects')): SessionInfo[] {
  if (!existsSync(root)) {
    console.error(`[sessions] 找不到 ${root}`)
    return []
  }
  const out: SessionInfo[] = []
  let projects: string[]
  try {
    projects = readdirSync(root)
  } catch (err) {
    console.error('[sessions] 讀取 projects 失敗:', err)
    return []
  }
  for (const project of projects) {
    const dir = join(root, project)
    let entries: string[]
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const file = join(dir, name)
      try {
        const st = statSync(file)
        if (!st.isFile()) continue
        const meta = firstMeta(file)
        // 略過 /analyze 一次性 query 自己產生的審查逐字稿(第一句就是審查 prompt)。
        if (meta.title.startsWith(ANALYSIS_PROMPT_OPENING)) continue
        out.push({
          file,
          project,
          cwd: meta.cwd,
          title: meta.title,
          mtime: st.mtimeMs,
          subagents: countSubagents(join(dir, name.slice(0, -'.jsonl'.length), 'subagents')),
        })
      } catch (err) {
        console.error(`[sessions] 略過 ${file}:`, err)
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

// 只讀檔頭(前 256KB)一次撈出 cwd 與「第一句 user 訊息」當標題。
// cwd 與第一句通常都在檔頭幾筆;限量讀避免掃描 6MB 大檔。兩者都拿到就提早結束。
export function firstMeta(file: string): { cwd: string; title: string } {
  let cwd = '', title = ''
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(262144)
    const n = readSync(fd, buf, 0, buf.length, 0)
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.trim()) continue
      let rec: any
      try {
        rec = JSON.parse(line)
      } catch {
        continue // 檔頭最後一行可能被截斷,略過
      }
      if (!cwd && typeof rec?.cwd === 'string') cwd = rec.cwd
      if (!title && rec?.type === 'user') {
        const t = cleanTitle(userText(rec?.message?.content))
        if (t) title = t
      }
      if (cwd && title) break
    }
  } catch (err) {
    console.error(`[sessions] 讀檔頭失敗 ${file}:`, err)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return { cwd, title }
}

// 相容既有呼叫端(transcriptSource 只要 cwd)。
export function firstCwd(file: string): string {
  return firstMeta(file).cwd
}

// user 訊息內容可能是字串或區塊陣列;只取 text 區塊串接。
function userText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? b.text : '')).join('')
  }
  return ''
}

// 清成可讀標題:slash 指令取 <command-name>(顯示成 /init);
// 其餘去掉 XML 式標籤、壓成單行、截斷 80 字。
function cleanTitle(raw: string): string {
  const cmd = raw.match(/<command-name>([^<]+)<\/command-name>/)
  if (cmd) return cmd[1].trim()
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function countSubagents(subDir: string): number {
  if (!existsSync(subDir)) return 0
  try {
    return readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}
