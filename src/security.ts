import { resolve, sep, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { SourceSystem } from './sourceSystems'

// 只允許本機 hostname。擋 DNS rebinding:attacker.com 就算解析到 127.0.0.1,
// 瀏覽器送出的 Host / Origin 仍是 attacker.com,無法通過。
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// 從 Host 字串取 hostname(去掉 port)。IPv6 形如 [::1]:3001;其餘 localhost:5173。
function hostname(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1)
  return host.split(':')[0]
}

export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  return LOCAL_HOSTS.has(hostname(host))
}

// WebSocket 允許的瀏覽器來源:本機任一 port。非瀏覽器客戶端不送 Origin(undefined)→ 放行
// (威脅對象是使用者造訪的網頁,那類請求一定帶 Origin)。不帶 Origin 的本機程式改由下方的存取 token 擋。
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    return isLocalHost(new URL(origin).host)
  } catch {
    return false // 'null'、畸形字串等一律拒絕
  }
}

// 反 CSRF:改狀態請求(非 GET/HEAD)須來自本機 Origin;讀取(GET/HEAD)一律放行
// (回應由瀏覽器同源政策保護)。非瀏覽器客戶端不送 Origin → 放行(與 WS 政策一致)。
export function isCsrfSafe(method: string, origin: string | undefined): boolean {
  if (method === 'GET' || method === 'HEAD') return true
  return isAllowedOrigin(origin)
}

// 各系統可觀察檔的白名單根目錄。
function observeRoot(system: SourceSystem): string {
  return system === 'antigravity'
    ? join(homedir(), '.gemini', 'antigravity')
    : join(homedir(), '.claude', 'projects')
}

// 驗證 file 落在 root 內。正規化後比對(加分隔符邊界,避免 projects-evil 這種前綴相同
// 卻非子目錄的繞過);實體檔再以 realpathSync 解析 symlink,防指向 root 外的連結繞過白名單。
// 檔案不存在時退回文字正規化(反正讀不到,且保留原行為)。
export function isUnderRoot(root: string, file: string): boolean {
  if (!file) return false
  const base = resolve(root)
  let target = resolve(file)
  try { target = realpathSync(target) } catch { /* 不存在 → 用正規化路徑 */ }
  return target === base || target.startsWith(base + sep)
}

// 驗證要觀察的檔案落在該系統允許的根目錄內,防任意檔讀 / 路徑穿越 / symlink 繞過。
export function isObservableFile(system: SourceSystem, file: string): boolean {
  return isUnderRoot(observeRoot(system), file)
}

// ── 本機存取 token ──────────────────────────────────────────────
// Host / Origin 檢查只擋得住「瀏覽器裡的惡意網頁」;本機任何程式(或同機其他使用者)
// 直接 curl 127.0.0.1:3001 不帶 Origin,以前會被放行 → 可 /start 叫 agent、/control approve
// 核准任意指令。解法同 Jupyter:每次啟動產生一組隨機 token,只印在啟動終端機,
// 每個 HTTP 請求(x-sv-token header)與 WS 連線(?token=)都必須帶對才放行。
export const TOKEN_HEADER = 'x-sv-token'

// 32 bytes 隨機 = 256 bit,猜中機率可忽略。可用 SV_TOKEN 環境變數固定(方便腳本 / 重啟不換網址)。
export function makeToken(fromEnv: string | undefined = process.env.SV_TOKEN): string {
  const t = fromEnv?.trim()
  return t ? t : randomBytes(32).toString('hex')
}

// 固定時間比較:一般 === 遇到第一個不同字元就停,回應時間會洩漏「猜對了幾個字」。
export function isValidToken(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || !expected) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

// 從 WS 握手的請求 URL(如 /?token=abc)取出 token。
export function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url, 'http://localhost').searchParams.get('token')
  } catch {
    return null
  }
}
