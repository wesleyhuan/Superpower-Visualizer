import { resolve, sep, join } from 'node:path'
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

// 各系統可觀察檔的白名單根目錄。
function observeRoot(system: SourceSystem): string {
  return system === 'antigravity'
    ? join(homedir(), '.gemini', 'antigravity')
    : join(homedir(), '.claude', 'projects')
}

// 驗證要觀察的檔案落在該系統允許的根目錄內。正規化後比對(加上分隔符邊界,
// 避免 projects-evil 這種前綴相同卻非子目錄的繞過),防任意檔讀 / 路徑穿越。
export function isObservableFile(system: SourceSystem, file: string): boolean {
  if (!file) return false
  const root = resolve(observeRoot(system))
  const target = resolve(file)
  return target === root || target.startsWith(root + sep)
}
