import type { FrontendEvent, NodeStatus } from './types'
import type { DecodedStep } from './antigravityProto'

export interface DecodedRow { idx: number; step_type: number; status: number; decoded: DecodedStep }

// status:2=進行中、3=完成(由探針校正);其餘保守當 done。
const STATUS: Record<number, NodeStatus> = { 2: 'running', 3: 'done' }

// 純函式:一筆已解碼的 Antigravity step + parentId → 前端事件。protobuf 不進這裡,方便用純物件測。
export function translateAntigravityStep(row: DecodedRow, parentId: string | null): FrontendEvent[] {
  const { idx, step_type, status, decoded } = row
  const args = decoded.args ?? {}
  const action = (args.toolAction ?? args.toolSummary) as string | undefined

  // 工具步驟優先判斷:Antigravity 常把「思考 + 動作」放在同一步(step_type 可能是 15),
  // 所以不能用 step_type 短路,否則會漏掉帶思考的工具。
  if (decoded.toolName || action) {
    const isSub = decoded.toolName === 'invoke_subagent'
    // toolSummary=「做了什麼」進動作標籤;toolAction=「為什麼」進 reason。兩者互補、100% 涵蓋、無雜訊。
    // (不用 decoded.text 當 reason:write_to_file 的 text 常是整份檔案內容,會洗版。)
    const summary = (args.toolSummary ?? args.toolAction ?? decoded.toolName ?? 'tool') as string
    const toolAction = args.toolAction as string | undefined
    const reason = toolAction && toolAction !== summary ? toolAction : undefined
    return [{
      kind: 'tree:node',
      node: {
        id: `ag-${idx}`,
        parentId,
        type: isSub ? 'subagent' : 'tool',
        label: `${decoded.toolName ?? 'tool'}: ${summary}`.slice(0, 80),
        status: STATUS[status] ?? 'done',
        ...(reason ? { reason } : {}),
      },
    }]
  }

  if (step_type === 14 && decoded.text) return [{ kind: 'message', role: 'user', text: decoded.text }]

  console.debug(`[antigravity] 未對映 step ${idx} type ${step_type}`) // 純思考 / 錯誤 / 訊息,v1 略過
  return []
}
