import { resolve, sep, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
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
// (威脅對象是使用者造訪的網頁,那類請求一定帶 Origin)。
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
