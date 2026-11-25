import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { buildApp, makeVerifyClient } from '../src/server'

// 假 runQuery:空的 async iterable,測路由時不會真的呼叫 Agent SDK。
const fakeRunQuery = () => (async function* () {})() as any
const TOKEN = 'test-token'
// 預設每個請求都帶正確 token;測 token 本身的案例改用 rawApp()。
const rawApp = (runQuery: any = fakeRunQuery) => buildApp({ runQuery, token: TOKEN }).app
const app = (runQuery: any = fakeRunQuery) => {
  const agent = request.agent(rawApp(runQuery))
  agent.set('x-sv-token', TOKEN)
  return agent
}

describe('server 路由:安全中介層', () => {
  it('非本機 Host → 403 forbidden host(反 rebinding)', async () => {
    const res = await app().get('/sessions').set('Host', 'evil.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden host')
  })

  it('跨站 Origin 的改狀態 POST → 403 forbidden origin(CSRF)', async () => {
    const res = await app().post('/new-agent').set('Origin', 'https://evil.com').send({})
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden origin')
  })

  it('本機 Origin 的 POST → 通過', async () => {
    const res = await app().post('/new-agent').set('Origin', 'http://localhost:5173').send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('無 Origin(非瀏覽器)的 POST → 通過', async () => {
    const res = await app().post('/new-agent').send({})
    expect(res.status).toBe(200)
  })

  it('跨站 Origin 的 GET → 通過(讀取放行,回應由 CORS 保護)', async () => {
    const res = await app().get('/sessions').set('Origin', 'https://evil.com')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.sessions)).toBe(true)
  })
})

describe('server 路由:/observe 白名單', () => {
  it('越界路徑 → 400(防任意檔讀)', async () => {
    const res = await app().post('/observe').send({ file: 'C:/Windows/System32/config' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/allowed directory/)
  })

  it('缺 file → 400', async () => {
    const res = await app().post('/observe').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing file/)
  })
})

describe('server 路由:本機存取 token', () => {
  it('沒帶 token 的 POST(就算沒有 Origin)→ 401', async () => {
    const res = await request(rawApp()).post('/start').send({ prompt: 'rm -rf' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('錯誤 token → 401', async () => {
    const res = await request(rawApp()).post('/control').set('x-sv-token', 'wrong').send({ type: 'approve', toolUseId: 'x', allow: true })
    expect(res.status).toBe(401)
  })

  it('GET 也要 token(/dirs 會洩漏檔案系統)', async () => {
    const res = await request(rawApp()).get('/dirs')
    expect(res.status).toBe(401)
  })

  it('正確 token → 通過', async () => {
    const res = await request(rawApp()).post('/new-agent').set('x-sv-token', TOKEN).send({})
    expect(res.status).toBe(200)
  })
})

describe('server 路由:/start 不重複開 session', () => {
  // 永遠不結束的假 agent:模擬真的 SDK(串流輸入沒關就一直等)。記錄被呼叫幾次。
  const hangingRunQuery = () => {
    const calls: any[] = []
    const rq = (args: any) => {
      calls.push(args)
      return (async function* () { await new Promise(() => {}) })()
    }
    return { rq, calls }
  }

  it('session 跑著時第二次 /start → 409,runQuery 只被呼叫一次', async () => {
    const { rq, calls } = hangingRunQuery()
    const a = app(rq)
    expect((await a.post('/start').send({ prompt: 'first' })).status).toBe(200)
    const second = await a.post('/start').send({ prompt: 'second' })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatch(/already running/)
    expect(calls).toHaveLength(1)
  })

  it('/new-agent 會先停掉舊 session,之後 /start 可以開新的', async () => {
    const { rq, calls } = hangingRunQuery()
    const a = app(rq)
    await a.post('/start').send({ prompt: 'first' })
    await a.post('/new-agent').send({})
    expect(calls[0].signal.aborted).toBe(true)
    expect((await a.post('/start').send({ prompt: 'second' })).status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('沒有 session 時的 followup → 409(不會偷偷排進下一個 session)', async () => {
    const res = await app().post('/control').send({ type: 'followup', text: 'hi' })
    expect(res.status).toBe(409)
  })
})

describe('WebSocket 握手檢查', () => {
  const verify = makeVerifyClient(TOKEN)
  it('本機 Origin + 正確 token → 放行', () => {
    expect(verify({ origin: 'http://localhost:5173', req: { url: `/?token=${TOKEN}` } })).toBe(true)
  })
  it('沒有 Origin(本機程式)但沒 token → 拒絕', () => {
    expect(verify({ req: { url: '/' } })).toBe(false)
  })
  it('token 錯 → 拒絕', () => {
    expect(verify({ origin: 'http://localhost:5173', req: { url: '/?token=nope' } })).toBe(false)
  })
  it('跨站 Origin 就算 token 對也拒絕', () => {
    expect(verify({ origin: 'https://evil.com', req: { url: `/?token=${TOKEN}` } })).toBe(false)
  })
})
