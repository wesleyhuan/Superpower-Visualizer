import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listDirs } from '../src/dirs'

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
