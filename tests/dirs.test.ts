import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listDirs, makeDir } from '../src/dirs'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dirs-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('listDirs', () => {
  it('只列子資料夾(忽略檔案),排序,附上 parent', () => {
    mkdirSync(join(root, 'beta'))
    mkdirSync(join(root, 'alpha'))
    writeFileSync(join(root, 'file.txt'), 'x')
    const r = listDirs(root)
    expect(r.path).toBe(root)
    expect(r.entries).toEqual(['alpha', 'beta'])
    expect(r.parent).toBe(dirname(root))
  })

  it('path 不存在 → 拋錯', () => {
    expect(() => listDirs(join(root, 'nope'))).toThrow()
  })

  it('path 指向檔案(非目錄)→ 拋錯', () => {
    const f = join(root, 'file.txt')
    writeFileSync(f, 'x')
    expect(() => listDirs(f)).toThrow()
  })

  it('空 path → 磁碟根視圖(依平台)', () => {
    const r = listDirs('')
    if (process.platform === 'win32') {
      // Windows:列磁碟機、entries 空、parent null
      expect(r.path).toBe('')
      expect(r.parent).toBeNull()
      expect(r.drives?.length ?? 0).toBeGreaterThan(0)
      expect(r.entries).toEqual([])
    } else {
      // POSIX:解析成 '/',照常列子資料夾、無 drives、根的 parent 為 null
      expect(r.path).toBe('/')
      expect(r.drives).toBeUndefined()
      expect(r.parent).toBeNull()
      expect(Array.isArray(r.entries)).toBe(true)
    }
  })

  it('讀不到的子項(斷掉的 symlink)略過,不整支失敗', () => {
    if (process.platform === 'win32') return // Windows 建 symlink 需權限,略過此案
    mkdirSync(join(root, 'good'))
    symlinkSync(join(root, 'missing-target'), join(root, 'dangling')) // statSync 追連結 → ENOENT
    const r = listDirs(root)
    expect(r.entries).toEqual(['good']) // dangling 被 catch 略過,good 保留
  })
})

describe('makeDir', () => {
  it('在父目錄下建空資料夾,回新路徑', () => {
    const p = makeDir(root, 'proj')
    expect(p).toBe(join(root, 'proj'))
    expect(existsSync(p)).toBe(true)
  })
  it('名稱含路徑分隔符 / .. → 拋錯', () => {
    expect(() => makeDir(root, '../evil')).toThrow()
    expect(() => makeDir(root, 'a/b')).toThrow()
    expect(() => makeDir(root, '..')).toThrow()
  })
  it('純空白名稱 → 拋錯', () => {
    expect(() => makeDir(root, '   ')).toThrow()
  })
  it('前後空白會被 trim(建立乾淨名稱)', () => {
    const p = makeDir(root, '  proj  ')
    expect(p).toBe(join(root, 'proj'))
    expect(existsSync(p)).toBe(true)
  })
  it('已存在 → 拋錯', () => {
    makeDir(root, 'dup')
    expect(() => makeDir(root, 'dup')).toThrow()
  })
  it('父目錄不存在 → 拋錯', () => {
    expect(() => makeDir(join(root, 'nope'), 'x')).toThrow()
  })
})
