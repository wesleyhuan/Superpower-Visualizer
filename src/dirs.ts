import { existsSync, statSync, readdirSync, mkdirSync } from 'node:fs'
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
  if (!path && process.platform === 'win32') {
    return { path: '', parent: null, drives: windowsDrives(), entries: [] }
  }
  const dir = path || '/' // POSIX 的磁碟根視圖解析成 '/'
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`不是有效的目錄:${dir}`)
  }
  const entries: string[] = []
  for (const name of readdirSync(dir)) {
    try {
      if (statSync(join(dir, name)).isDirectory()) entries.push(name)
    } catch {
      // 權限/連結問題的子項略過,不讓整支失敗
    }
  }
  entries.sort((a, b) => a.localeCompare(b))
  return { path: dir, parent: parentOf(dir), entries }
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
    if (existsSync(d)) out.push(d)
  }
  return out
}

// 在 parent 下建立一個空資料夾。防呆:name 不含路徑分隔符 / 非 . .. ;parent 須存在且是目錄。
export function makeDir(parent: string, name: string): string {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) {
    throw new Error(`資料夾名稱非法:${name}`)
  }
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`父目錄不存在:${parent}`)
  }
  const full = join(parent, clean)
  if (existsSync(full)) throw new Error(`已存在:${full}`)
  mkdirSync(full)
  return full
}
