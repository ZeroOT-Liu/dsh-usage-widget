/**
 * Host-half smoke test without a running Harness.
 *
 * It guards the bug that shipped in 1.1.1: the host half read `ctx.webServer`
 * without declaring it in `inject`, Cordis refused the read, the failure was
 * swallowed, and the summary route was never registered. On a warm reload the
 * service was already up so it looked fine; on a cold start the widget got 401
 * from the API gateway and showed no usage and no balance.
 *
 * The fake context reproduces Cordis's rule — a service read is refused unless
 * the plugin declared it — so dropping the `inject` export fails here.
 *
 * Run: node test/host-smoke.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const plugin = await import(pathToFileURL(path.join(here, '..', 'index.js')).href)

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`)
  }
}

/* ------------------------------------------------------------- fake host */

const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-smoke-'))

function fakeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

function fakeRes() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    writeHead(status, headers) {
      out.status = status
      out.headers = headers ?? null
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) out.body += String(chunk)
    },
  }
}

const logged = { info: [], warn: [], error: [] }

/**
 * Cordis refuses `ctx.<service>` for a service the plugin did not declare in
 * `inject`; `ctx.get(name)` is the explicit, inject-free accessor for optional
 * services, so it stays available for undeclared names.
 */
function makeCtx(pluginExports, services) {
  const declared = new Set(Array.from(pluginExports.inject ?? []))
  const cleanups = []
  const target = {
    logger: {
      info: (message) => logged.info.push(String(message)),
      warn: (message) => logged.warn.push(String(message)),
      error: (message) => logged.error.push(String(message)),
    },
    effect(fn) {
      const cleanup = fn()
      cleanups.push(cleanup)
      return cleanup
    },
    get(name) {
      return services[name]
    },
  }
  const ctx = new Proxy(target, {
    get(base, prop, receiver) {
      if (typeof prop === 'symbol' || prop in base) return Reflect.get(base, prop, receiver)
      if (declared.has(prop) && prop in services) return services[prop]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
  return { ctx, cleanups }
}

const webServer = fakeWebServer()
const { ctx, cleanups } = makeCtx(plugin, { webServer })

let activationError = null
try {
  plugin.apply(ctx, { sessionsDir })
} catch (error) {
  activationError = error
}

console.log('host half, with a Cordis-like context\n')

await check('activates without Cordis refusing a service read', () => {
  assert.equal(
    activationError,
    null,
    `apply() threw: ${activationError?.message} — declare the service in \`inject\``,
  )
})

await check('declares the web server service it reads', () => {
  assert.ok(Array.isArray(Array.from(plugin.inject)), 'inject must be an array')
  assert.ok(
    Array.from(plugin.inject).includes('webServer'),
    'inject must include webServer, or a cold start never registers the route',
  )
})

await check('registers exactly one exact route at the documented path', () => {
  assert.equal(webServer.routes.length, 1)
  assert.equal(webServer.routes[0].kind, 'exact')
  assert.equal(webServer.routes[0].path, plugin.ROUTE)
  assert.equal(plugin.ROUTE, '/api/dsh-usage-widget/summary')
})

await check('reports no activation error while the service is present', () => {
  assert.deepEqual(logged.error, [])
})

const route = webServer.routes[0]

await check('rejects methods other than GET and HEAD', async () => {
  const res = fakeRes()
  await route.handler({ method: 'POST', url: plugin.ROUTE, headers: {} }, res)
  assert.equal(res.out.status, 405)
  assert.equal(res.out.headers.allow, 'GET, HEAD')
})

await check('rejects a non-loopback Host', async () => {
  const res = fakeRes()
  await route.handler({ method: 'GET', url: plugin.ROUTE, headers: { host: 'evil.example' } }, res)
  assert.equal(res.out.status, 403)
  assert.match(res.out.body, /untrusted request/)
})

await check('rejects a cross-site Origin', async () => {
  const res = fakeRes()
  await route.handler(
    {
      method: 'GET',
      url: plugin.ROUTE,
      headers: { host: '127.0.0.1:19387', origin: 'http://evil.example' },
    },
    res,
  )
  assert.equal(res.out.status, 403)
})

await check('answers a loopback GET with the summary payload', async () => {
  const res = fakeRes()
  await route.handler(
    { method: 'GET', url: `${plugin.ROUTE}?sessionId=session-abc`, headers: { host: '127.0.0.1:19387' } },
    res,
  )
  assert.equal(res.out.status, 200)
  assert.match(res.out.headers['content-type'], /application\/json/)
  assert.equal(res.out.headers['cache-control'], 'no-store')
  const payload = JSON.parse(res.out.body)
  assert.equal(payload.ok, true)
  assert.ok(payload.today !== undefined, 'today block present')
  assert.equal(payload.today.totalTokens, 0, 'an empty sessions directory totals zero')
  // No account service was provided, so the balance degrades instead of failing.
  assert.equal(payload.balance.status, 'unavailable')
  assert.equal(payload.session.id, 'session-abc')
})

await check('disposes the route on unload', () => {
  assert.equal(typeof cleanups[0], 'function')
  cleanups[0]()
  assert.equal(webServer.routes.length, 0)
})

fs.rmSync(sessionsDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
