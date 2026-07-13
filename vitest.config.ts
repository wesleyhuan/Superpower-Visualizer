import { defineConfig } from 'vitest/config'
// web/ 是獨立的 Vite 前端專案,有自己的 vitest 設定(jsdom)。
// 後端根測試只跑 node 環境,排除 web/ 以免用錯環境。
export default defineConfig({
  test: { environment: 'node', exclude: ['**/node_modules/**', 'web/**'] },
})
