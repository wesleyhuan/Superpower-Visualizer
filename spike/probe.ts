import { query } from '@anthropic-ai/claude-agent-sdk'

// 目標:觀察並記錄 5 個待驗證點的實際形狀。
// 需要可用的 Anthropic 憑證(ANTHROPIC_API_KEY 環境變數,或已 `ant auth login` 的 profile 皆可;
// 先用 `ant auth status` 確認)。
async function main() {
  const q = query({
    prompt: '請用 Grep 在目前資料夾找出所有 .ts 檔,然後用一個 subagent 總結你找到什麼。',
    options: {
      // 觀察點 2:canUseTool 的簽名與回傳
      canUseTool: async (toolName, input) => {
        console.log('[canUseTool]', toolName, JSON.stringify(input).slice(0, 200))
        return { behavior: 'allow', updatedInput: input }
      },
    },
  })
  for await (const msg of q) {
    // 觀察點 1/3/4/5:type、parent_tool_use_id、content blocks、skill 呈現方式
    console.log('=== SDKMessage ===')
    console.log(JSON.stringify(msg, null, 2))
  }
}
main().catch((e) => console.error('[spike] error:', e))
