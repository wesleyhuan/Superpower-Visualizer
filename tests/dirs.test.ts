import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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
  it('已存在 → 拋錯', () => {
    makeDir(root, 'dup')
    expect(() => makeDir(root, 'dup')).toThrow()
  })
  it('父目錄不存在 → 拋錯', () => {
    expect(() => makeDir(join(root, 'nope'), 'x')).toThrow()
  })
})
