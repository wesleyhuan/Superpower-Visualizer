import { existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface SessionInfo {
  file: string      // 主 .jsonl 絕對路徑
  project: string   // 專案資料夾名(slug)
  cwd: string       // 該 session 的工作目錄(取自逐字稿第一筆)
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
        out.push({
          file,
          project,
          cwd: firstCwd(file),
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

// 只讀檔頭(前 64KB)找 cwd:逐字稿開頭常是沒有 cwd 的 summary 記錄,
// cwd 通常在頭幾筆 user/assistant;限量讀避免掃描 6MB 大檔。
export function firstCwd(file: string): string {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(65536)
    const n = readSync(fd, buf, 0, buf.length, 0)
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.trim()) continue
      try {
        const cwd = JSON.parse(line)?.cwd
        if (typeof cwd === 'string') return cwd
      } catch {
        // 檔頭最後一行可能被截斷,略過
      }
    }
  } catch (err) {
    console.error(`[sessions] 讀 cwd 失敗 ${file}:`, err)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return ''
}

function countSubagents(subDir: string): number {
  if (!existsSync(subDir)) return 0
  try {
    return readdirSync(subDir).filter((n) => n.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}
