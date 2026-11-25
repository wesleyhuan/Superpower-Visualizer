// 本機存取 token(後端每次啟動隨機產生,印在後端終端機的網址上:/?token=...)。
// 讀取順序:網址 ?token= → sessionStorage。從網址讀到後:
//   1. 存進 sessionStorage(同一分頁重新整理還能用;關掉分頁就消失)
//   2. 用 history.replaceState 把它從網址列拿掉,避免被截圖、分享或留在瀏覽紀錄。
const KEY = 'sv-token'

export function readAuthToken(loc: Pick<Location, 'search' | 'pathname' | 'hash'> = location): string | null {
  const fromUrl = new URLSearchParams(loc.search).get('token')
  if (fromUrl) {
    try { sessionStorage.setItem(KEY, fromUrl) } catch { /* 私密模式等:只用這次 */ }
    try {
      const params = new URLSearchParams(loc.search)
      params.delete('token')
      const rest = params.toString()
      history.replaceState(null, '', loc.pathname + (rest ? `?${rest}` : '') + loc.hash)
    } catch { /* 測試環境等沒有 history 也沒關係 */ }
    return fromUrl
  }
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

// 把 token 加到 WS 網址(瀏覽器的 WebSocket 不能自訂 header,只能走 query)。
export function withToken(url: string, token: string | null): string {
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}
