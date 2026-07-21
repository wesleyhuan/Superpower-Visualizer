import { existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface DirListing {
  path: string
  parent: string | null
  drives?: string[]
  entries: string[]
}

// 列出某目錄下的「子資料夾」供 UI 導覽。path 為空 → 磁碟根視圖
// (Windows 列磁碟機、entries 空;POSIX 解析成 '/' 照常列)。
export function listDirs(path: string): DirListing {
  if (!path) {
    if (process.platform === 'win32') {
      return { path: '', parent: null, drives: windowsDrives(), entries: [] }
    }
    path = '/'
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`不是有效的目錄:${path}`)
  }
  const entries: string[] = []
  for (const name of readdirSync(path)) {
    try {
      if (statSync(join(path, name)).isDirectory()) entries.push(name)
    } catch {
      // 權限/連結問題的子項略過,不讓整支失敗
    }
  }
  entries.sort((a, b) => a.localeCompare(b))
  return { path, parent: parentOf(path), entries }
}

// 上一層;已在根時:Windows 回 ''(前端顯示磁碟機清單)、POSIX 回 null。
function parentOf(path: string): string | null {
  const up = dirname(path)
  if (up === path) return process.platform === 'win32' ? '' : null
  return up
}

function windowsDrives(): string[] {
  const out: string[] = []
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`
    try { if (existsSync(d)) out.push(d) } catch { /* skip */ }
  }
  return out
}
