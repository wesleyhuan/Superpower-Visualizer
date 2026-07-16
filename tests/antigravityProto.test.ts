import { describe, it, expect } from 'vitest'
import { decodeStep, harvestStrings } from '../src/antigravityProto'

// 手工組 protobuf(privacy-safe,不用真實資料):varint tag + length-delimited。
function varint(n: number): number[] { const b: number[] = []; while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n >>>= 7 } b.push(n); return b }
function lenField(fieldNo: number, bytes: Buffer): Buffer {
  const tag = (fieldNo << 3) | 2
  return Buffer.concat([Buffer.from(varint(tag)), Buffer.from(varint(bytes.length)), bytes])
}
function str(fieldNo: number, s: string): Buffer { return lenField(fieldNo, Buffer.from(s, 'utf8')) }

describe('harvestStrings', () => {
  it('遞迴 length-delimited,撈出文字葉節點', () => {
    const nested = Buffer.concat([str(1, 'u2nlmji4'), str(2, 'view_file')])
    const payload = lenField(4, nested)
    expect(harvestStrings(payload)).toEqual(expect.arrayContaining(['u2nlmji4', 'view_file']))
  })
})

describe('decodeStep', () => {
  it('抽得到 toolName 與 args(內嵌 JSON)', () => {
    const json = '{"AbsolutePath":"C:\\\\x","toolAction":"Read original user request file","toolSummary":"Read x"}'
    const inner = Buffer.concat([str(1, 'u2nlmji4'), str(2, 'view_file'), str(3, json)])
    const d = decodeStep(lenField(4, inner))
    expect(d.toolName).toBe('view_file')
    expect((d.args as any).toolAction).toBe('Read original user request file')
  })

  it('抽得到 assistant/使用者散文(最長、非 JSON)', () => {
    const inner = Buffer.concat([str(1, 'Please read the user requirements in C:\\Users\\x\\REQ.md and summarise.')])
    expect(decodeStep(lenField(9, inner)).text).toContain('Please read the user requirements')
  })

  it('截斷的 JSON 不 crash,回無 args', () => {
    const inner = str(3, '{"AbsolutePath":"C:\\\\x","toolActi')  // 被截斷
    expect(() => decodeStep(lenField(4, inner))).not.toThrow()
    expect(decodeStep(lenField(4, inner)).args).toBeUndefined()
  })
})
