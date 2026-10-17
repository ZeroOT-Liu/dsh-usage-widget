/**
 * Row-config normalization for the widget.
 *
 * The plugin deliberately exports no Cordis `Config` schema: profile-installed
 * bundles cannot resolve `@deepseek-ai/schemastery` from the profile's
 * `node_modules`, so the row config is validated here instead and every field
 * falls back to a working default.
 *
 * @module dsh-usage-widget/config
 */
import { DEFAULT_ALIASES, DEFAULT_PRICES } from './pricing.js'

/** Reported to the DeepSeek platform as the requesting client version. */
export const VERSION = '1.0.0'

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function bounded(value, min, max, fallback) {
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function priceEntry(raw) {
  if (!isPlainObject(raw)) return null
  const entry = {
    cacheHit: bounded(raw.cacheHit, 0, 1e6, 0),
    cacheMiss: bounded(raw.cacheMiss, 0, 1e6, 0),
    output: bounded(raw.output, 0, 1e6, 0),
  }
  return entry.cacheHit + entry.cacheMiss + entry.output > 0 ? entry : null
}

/**
 * Normalize the plugin row config.
 * @param raw - `config` handed to `apply`.
 * @returns a complete settings object with every field defaulted.
 */
export function normalizeConfig(raw) {
  const config = isPlainObject(raw) ? raw : {}

  const models = {}
  if (isPlainObject(config.models)) {
    for (const [name, value] of Object.entries(config.models)) {
      const entry = priceEntry(value)
      if (entry !== null && name.length > 0) models[name] = entry
    }
  }
  // An empty or fully invalid table keeps the published defaults rather than
  // silently reporting every model as unpriced.
  if (Object.keys(models).length === 0) Object.assign(models, DEFAULT_PRICES)

  const aliases = { ...DEFAULT_ALIASES }
  if (isPlainObject(config.aliases)) {
    for (const [from, to] of Object.entries(config.aliases)) {
      if (typeof to === 'string' && to.length > 0) aliases[from] = to
    }
  }

  // Extra hostnames the summary route may answer besides loopback ones, for
  // deployments that serve the GUI on a named address.
  const allowHosts = Array.isArray(config.allowHosts)
    ? config.allowHosts.filter((value) => typeof value === 'string' && value.length > 0).map((value) => value.toLowerCase())
    : []

  return {
    allowHosts,
    currency: typeof config.currency === 'string' && config.currency.length > 0 ? config.currency : 'CNY',
    refreshSeconds: bounded(config.refreshSeconds, 5, 3600, 30),
    balanceRefreshSeconds: bounded(config.balanceRefreshSeconds, 15, 86400, 180),
    peakMultiplier: bounded(config.peakMultiplier, 1, 10, 2),
    keepDays: bounded(config.keepDays, 2, 400, 45),
    sessionsDir: typeof config.sessionsDir === 'string' && config.sessionsDir.length > 0 ? config.sessionsDir : null,
    locale: typeof config.locale === 'string' && config.locale.length > 0 ? config.locale : 'zh-CN',
    // Month-to-date appears as a third summary line in the sidebar footer; for
    // some users a compact footer matters more than the extra figure.
    showMonth: config.showMonth !== false,
    // The peak/off-peak badge is a live hint rather than a running total, so it
    // can be switched off on its own without losing the month line.
    showWindow: config.showWindow !== false,
    models,
    aliases,
  }
}
