import type { FrontendEvent, NodeStatus } from './types'
import type { DecodedStep } from './antigravityProto'

export interface DecodedRow { idx: number; step_type: number; status: number; decoded: DecodedStep }

// status:2=進行中、3=完成(由探針校正);其餘保守當 done。
const STATUS: Record<number, NodeStatus> = { 2: 'running', 3: 'done' }

// 純函式:一筆已解碼的 Antigravity step + parentId → 前端事件。protobuf 不進這裡,方便用純物件測。
export function translateAntigravityStep(row: DecodedRow, parentId: string | null): FrontendEvent[] {
  const { idx, step_type, status, decoded } = row

  if (step_type === 14 && decoded.text) return [{ kind: 'message', role: 'user', text: decoded.text }]
  if (step_type === 15) { console.debug(`[antigravity] 略過思考 step ${idx}`); return [] } // v1 不顯示 type-15

  const args = decoded.args ?? {}
  const action = (args.toolAction ?? args.toolSummary) as string | undefined
  if (decoded.toolName || action) {
    const isSub = decoded.toolName === 'invoke_subagent'
    const summary = (args.toolSummary ?? action ?? decoded.toolName ?? 'tool') as string
    return [{
      kind: 'tree:node',
      node: {
        id: `ag-${idx}`,
        parentId,
        type: isSub ? 'subagent' : 'tool',
        label: `${decoded.toolName ?? 'tool'}: ${summary}`.slice(0, 80),
        status: STATUS[status] ?? 'done',
        // Antigravity 每工具自帶 toolAction = 明文的「為什麼」,直接內嵌;不經 assembler 批次配對。
        ...(action ? { reason: action } : {}),
      },
    }]
  }

  console.debug(`[antigravity] 未對映 step ${idx} type ${step_type}`)
  return []
}
