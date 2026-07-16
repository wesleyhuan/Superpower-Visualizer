// Antigravity 逐字稿的 step_payload 是 protobuf(二進位),工具參數以 JSON 字串、
// assistant/使用者散文以明文內嵌。這裡用泛型 wire-format 走訪把文字撈出來,不需 .proto。

export interface DecodedStep {
  toolName?: string
  args?: Record<string, unknown>
  text?: string // 最長散文(assistant 思考 / 使用者任務)
}

// 已知工具集(由探針校正;非窮舉,未知工具仍會被當 tool 處理)
const KNOWN_TOOLS = new Set([
  'view_file', 'write_to_file', 'run_command', 'find_by_name', 'list_dir',
  'invoke_subagent', 'schedule', 'replace_file_content', 'grep_search',
  'read_url_content', 'search_web', 'propose_code',
])

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0, p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return [result, p]
    shift += 7
    if (shift > 56) break // 超出 JS number 安全範圍,放棄
  }
  return [result, p]
}

// 判斷一段 bytes 是「文字葉節點」(JSON / 散文)還是巢狀 message。
// 關鍵判別:文字葉節點的「內容」不含硬控制位元組;巢狀 message 的 tag/len 幾乎必含
// 小控制位元組(0x08、0x12…)。比「印字比例」更準,對小訊息也不誤判。
function asText(b: Buffer): string | null {
  if (b.length < 3) return null
  for (const byte of b) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return null // 硬控制碼 → 是 message
    if (byte === 0x7f) return null
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null }
}

export function harvestStrings(buf: Buffer, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let pos = 0
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos)
    if (p1 <= pos) break
    const wire = tag & 0x7
    pos = p1
    if (wire === 0) pos = readVarint(buf, pos)[1]
    else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos)
      pos = p2
      const sub = buf.subarray(pos, pos + len)
      pos += len
      const t = asText(sub)
      if (t !== null) out.push(t)
      else harvestStrings(sub, out, depth + 1)
    } else break // 未知 wire type,停
  }
  return out
}

export function decodeStep(payload: Buffer): DecodedStep {
  const texts = harvestStrings(payload)
  const out: DecodedStep = {}

  for (const s of texts) {
    if (!s.trimStart().startsWith('{')) continue
    try { const o = JSON.parse(s); if (o && typeof o === 'object') { out.args = o as Record<string, unknown>; break } }
    catch { /* 內嵌 JSON 可能被截斷,略過 */ }
  }
  out.toolName = texts.find((s) => /^[a-z][a-z_]{2,30}$/.test(s) && KNOWN_TOOLS.has(s))

  const prose = texts
    .filter((s) => s.includes(' ') && !s.trimStart().startsWith('{') &&
      !/^[0-9a-f-]{20,}$/i.test(s) && !s.includes('thinkingSignature'))
    .sort((a, b) => b.length - a.length)[0]
  if (prose) out.text = prose

  return out
}
