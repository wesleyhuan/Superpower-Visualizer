import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { decodeStep, harvestStrings } from './antigravityProto'

export interface AntigravitySessionInfo {
  system: 'antigravity'
  file: string
  identity: string // 角色身分(orchestrator / explorer …)
  cwd: string
  mtime: number
  steps: number
}

function defaultRoot(): string {
  return join(homedir(), '.gemini', 'antigravity', 'conversations')
}

// 從 trajectory_metadata_blob('main') 撈角色身分(teamwork_* / *orchestrator* …)。
function readIdentity(db: DatabaseSync): string {
  try {
    const row = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get() as { data?: Uint8Array } | undefined
    if (!row?.data) return ''
    const texts = harvestStrings(Buffer.from(row.data))
    const RE = /teamwork|orchestr|explorer|reviewer|auditor|agent/i
    // 優先選無空格的角色 token(teamwork_preview_orchestrator),避免抓到含 "agent" 的描述句。
    const token = texts.find((s) => !s.includes(' ') && RE.test(s))
    return (token ?? texts.find((s) => RE.test(s)))?.slice(0, 60) ?? ''
  } catch (err) { console.error('[antigravity] 讀身分失敗:', err); return '' }
}

// 掃前幾個 step 的工具參數,找第一個帶路徑欄位 → 取其目錄當工作目錄。
function readCwd(db: DatabaseSync): string {
  try {
    const rows = db.prepare('SELECT step_payload FROM steps ORDER BY idx LIMIT 20').all() as Array<{ step_payload?: Uint8Array }>
    for (const r of rows) {
      if (!r.step_payload) continue
      const args = decodeStep(Buffer.from(r.step_payload)).args as Record<string, unknown> | undefined
      const p = (args?.Cwd ?? args?.SearchDirectory ?? args?.DirectoryPath ?? args?.AbsolutePath) as string | undefined
      if (typeof p === 'string' && p) return args?.AbsolutePath ? dirname(p) : p
    }
  } catch (err) { console.error('[antigravity] 讀 cwd 失敗:', err) }
  return ''
}

export function listAntigravitySessions(root = defaultRoot()): AntigravitySessionInfo[] {
  let files: string[]
  try { files = readdirSync(root).filter((f) => f.endsWith('.db')) }
  catch (err) { console.error(`[antigravity] 列 conversations 失敗 ${root}:`, err); return [] }

  const out: AntigravitySessionInfo[] = []
  for (const f of files) {
    const file = join(root, f)
    let db: DatabaseSync | undefined
    try {
      const mtime = statSync(file).mtimeMs
      db = new DatabaseSync(file, { readOnly: true })
      const steps = (db.prepare('SELECT count(*) AS c FROM steps').get() as { c: number }).c
      out.push({ system: 'antigravity', file, identity: readIdentity(db), cwd: readCwd(db), mtime, steps })
    } catch (err) { console.error(`[antigravity] 讀 session 失敗 ${file}:`, err) }
    finally { try { db?.close() } catch { /* ignore */ } }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export function antigravityWorkspace(file: string): string {
  let db: DatabaseSync | undefined
  try { db = new DatabaseSync(file, { readOnly: true }); return readCwd(db) || file }
  catch (err) { console.error(`[antigravity] workspace 失敗 ${file}:`, err); return file }
  finally { try { db?.close() } catch { /* ignore */ } }
}
