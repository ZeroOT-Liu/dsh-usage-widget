/**
 * Host half of the usage widget.
 *
 * It owns one exact HTTP route that the Client half polls, and nothing else:
 * no session events are appended, no other plugin's registrations are touched,
 * and no model-visible content is added.
 *
 * @module dsh-usage-widget
 */
import { normalizeConfig } from './lib/config.js'
import { createUsageService } from './lib/service.js'

export const name = 'dsh-usage-widget'

/** Exact path served to the browser half. */
export const ROUTE = '/api/dsh-usage-widget/summary'

/** Resolve an optional service by name, preferring the property accessor. */
function optionalService(ctx, key) {
  try {
    const viaGet = ctx?.get?.(key)
    if (viaGet !== undefined && viaGet !== null) return viaGet
  } catch {
    // Fall through to the property accessor.
  }
  try {
    return ctx?.[key] ?? null
  } catch {
    return null
  }
}

/** Hostname of a `Host`/`Origin` authority, without its port. */
function authorityHostname(authority) {
  const value = String(authority ?? '')
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end).toLowerCase() : ''
  }
  const colon = value.lastIndexOf(':')
  return (colon > 0 ? value.slice(0, colon) : value).toLowerCase()
}

function isLoopbackName(name) {
  if (name === 'localhost' || name === '::1') return true
  if (name.endsWith('.localhost')) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)
}

/**
 * The route is registered as an exact path so it wins over the connection's
 * `/api` prefix, which means it does not inherit that layer's browser session
 * check. It carries account data, so the same loopback/authority trust rules
 * are applied here before anything is answered.
 */
function isTrustedCaller(req, extraHosts) {
  const host = req.headers?.host
  if (typeof host !== 'string' || host.length === 0) return false
  const hostname = authorityHostname(host)
  if (!isLoopbackName(hostname) && !extraHosts.includes(hostname)) return false

  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originAuthority
    try {
      originAuthority = new URL(origin).host
    } catch {
      return false
    }
    if (originAuthority.toLowerCase() !== host.toLowerCase()) return false
  }
  if (String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false
  return true
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Mount the host half.
 * @param ctx - the plugin's Cordis context.
 * @param config - the bundle row's config.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const logger = ctx?.logger ?? null
  const service = createUsageService({ ctx, config: settings, logger })

  // Warm the index once so the first widget poll does not pay for the full
  // history scan.
  service.index.refresh().catch(() => {})

  const stats = service.index.stats()
  logger?.info?.(
    `[dsh-usage-widget] watching ${stats.sessionsDir} (refresh ${settings.refreshSeconds}s, balance ${settings.balanceRefreshSeconds}s)`,
  )

  ctx.effect(() => {
    const webServer = optionalService(ctx, 'webServer')
    if (webServer === null || typeof webServer.register !== 'function') {
      logger?.warn?.('[dsh-usage-widget] webServer service unavailable; the widget cannot load data')
      return () => {}
    }
    return webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        if (!isTrustedCaller(req, settings.allowHosts)) {
          sendJson(res, 403, { ok: false, error: 'untrusted request' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const payload = await service.summary({
            sessionId: url.searchParams.get('sessionId'),
            force: url.searchParams.get('force') === '1',
          })
          sendJson(res, 200, payload)
        } catch (error) {
          logger?.warn?.(`[dsh-usage-widget] summary failed: ${error?.message ?? error}`)
          sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
        }
      },
    })
  }, 'dsh-usage-widget: summary route')
}
