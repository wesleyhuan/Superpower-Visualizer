import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { isLocalHost, isAllowedOrigin, isObservableFile } from '../src/security'

describe('isLocalHost(反 DNS rebinding)', () => {
  it('本機 hostname(含各種 port)→ true', () => {
    expect(isLocalHost('localhost:3001')).toBe(true)
    expect(isLocalHost('localhost:5173')).toBe(true)
    expect(isLocalHost('127.0.0.1:3001')).toBe(true)
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('[::1]:3001')).toBe(true)
  })
  it('非本機 hostname → false', () => {
    expect(isLocalHost('attacker.com:3001')).toBe(false)
    expect(isLocalHost('evil.example')).toBe(false)
    expect(isLocalHost('127.0.0.1.attacker.com')).toBe(false)
  })
  it('缺 Host → false', () => {
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalHost('')).toBe(false)
  })
})

describe('isAllowedOrigin(WebSocket 來源)', () => {
  it('無 Origin(非瀏覽器客戶端)→ 放行', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
  })
  it('本機來源 → 放行', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:3001')).toBe(true)
  })
  it('外部網站 / null origin → 拒絕', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false)
    expect(isAllowedOrigin('http://attacker.com:3001')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
  })
})

describe('isObservableFile(觀察檔白名單,防任意檔讀)', () => {
  const claudeFile = join(homedir(), '.claude', 'projects', 'proj', 'sess.jsonl')
  const antigravityFile = join(homedir(), '.gemini', 'antigravity', 'conversations', 'c.db')

  it('落在允許根目錄內 → true', () => {
    expect(isObservableFile('claude', claudeFile)).toBe(true)
    expect(isObservableFile('antigravity', antigravityFile)).toBe(true)
  })
  it('根目錄外 / 路徑穿越 → false', () => {
    expect(isObservableFile('claude', 'C:/Windows/System32/config')).toBe(false)
    expect(isObservableFile('claude', resolve(homedir(), '.claude', 'projects', '..', '..', 'secret.txt'))).toBe(false)
    // 前綴相同但非子目錄(projects-evil 不是 projects 的子目錄)
    expect(isObservableFile('claude', join(homedir(), '.claude', 'projects-evil', 'x.jsonl'))).toBe(false)
  })
  it('claude 檔不能用 antigravity 根目錄放行(系統各自的白名單)', () => {
    expect(isObservableFile('antigravity', claudeFile)).toBe(false)
  })
  it('空路徑 → false', () => {
    expect(isObservableFile('claude', '')).toBe(false)
  })
})
