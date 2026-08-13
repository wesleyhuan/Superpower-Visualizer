import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/server'

// 假 runQuery:空的 async iterable,測路由時不會真的呼叫 Agent SDK。
const fakeRunQuery = () => (async function* () {})() as any
const app = () => buildApp({ runQuery: fakeRunQuery }).app

describe('server 路由:安全中介層', () => {
  it('非本機 Host → 403 forbidden host(反 rebinding)', async () => {
    const res = await request(app()).get('/sessions').set('Host', 'evil.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden host')
  })

  it('跨站 Origin 的改狀態 POST → 403 forbidden origin(CSRF)', async () => {
    const res = await request(app()).post('/new-agent').set('Origin', 'https://evil.com').send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden origin')
  })

  it('本機 Origin 的 POST → 通過', async () => {
    const res = await request(app()).post('/new-agent').set('Origin', 'http://localhost:5173').send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('無 Origin(非瀏覽器)的 POST → 通過', async () => {
    const res = await request(app()).post('/new-agent').send({})
    expect(res.status).toBe(200)
  })

  it('跨站 Origin 的 GET → 通過(讀取放行,回應由 CORS 保護)', async () => {
    const res = await request(app()).get('/sessions').set('Origin', 'https://evil.com')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.sessions)).toBe(true)
  })
})

describe('server 路由:/observe 白名單', () => {
  it('越界路徑 → 400(防任意檔讀)', async () => {
    const res = await request(app()).post('/observe').send({ file: 'C:/Windows/System32/config' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/allowed directory/)
  })

  it('缺 file → 400', async () => {
    const res = await request(app()).post('/observe').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing file/)
  })
})
