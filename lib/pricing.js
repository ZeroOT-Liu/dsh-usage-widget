/**
 * Token pricing for the widget.
 *
 * DSH itself carries no per-token price table (its LLM adapters only declare
 * image pricing), so the prices live in this plugin's config. Defaults follow
 * the published DeepSeek price list, quoted in CNY per million tokens for the
 * **off-peak** window; the peak window is exactly twice that, so a single
 * `peakMultiplier` (default 2) reproduces the published table.
 *
 * Peak windows are defined in Beijing time (UTC+8): Monday–Friday 09:00–12:00
 * and 14:00–18:00. Chinese statutory holidays are *not* modelled — they are a
 * published calendar, not a rule, so holiday days are billed as peak here.
 *
 * @module dsh-usage-widget/pricing
 */

/** Milliseconds in the Beijing offset used by the published peak windows. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** Off-peak prices in currency units per million tokens. */
export const DEFAULT_PRICES = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

/** Legacy or dated model ids mapped onto a priced key. */
export const DEFAULT_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek-v4-pro-0813': 'deepseek-v4-pro',
}

/**
 * Whether a moment falls in the published peak window.
 * @param timeMs - epoch milliseconds of the usage record.
 * @returns true when Beijing local time is in a peak window on a weekday.
 */
export function isPeak(timeMs) {
  const shifted = new Date(timeMs + BEIJING_OFFSET_MS)
  const weekday = shifted.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

/**
 * Resolve the priced key for a provider-reported model id.
 * @param model - the model id recorded on the usage record.
 * @param prices - configured price table keyed by priced model name.
 * @param aliases - configured alias map.
 * @returns the priced key, or null when the model has no price.
 */
export function resolveModelKey(model, prices, aliases) {
  if (typeof model !== 'string' || model.length === 0) return null
  if (Object.prototype.hasOwnProperty.call(prices, model)) return model
  const alias = aliases[model]
  if (typeof alias === 'string' && Object.prototype.hasOwnProperty.call(prices, alias)) return alias
  const lowered = model.toLowerCase()
  // Fall back to family matching so an unseen dated or -exp id still prices.
  for (const family of ['flash', 'pro']) {
    if (!lowered.includes(family)) continue
    const hit = Object.keys(prices).find((key) => key.toLowerCase().includes(family))
    if (hit !== undefined) return hit
  }
  return null
}

/**
 * Cost of one model's accumulated tokens.
 * @param usage - `{ peak, offPeak }` token splits, each `{ input, cacheRead, output }`.
 * @param price - off-peak price for the model.
 * @param peakMultiplier - multiplier applied to the peak window.
 * @returns the cost in the configured currency.
 */
export function modelCost(usage, price, peakMultiplier) {
  const off = usage.offPeak ?? { input: 0, cacheRead: 0, output: 0 }
  const peak = usage.peak ?? { input: 0, cacheRead: 0, output: 0 }
  const perMillion = (bucket, factor) =>
    factor *
    ((bucket.input / 1e6) * price.cacheMiss +
      (bucket.cacheRead / 1e6) * price.cacheHit +
      (bucket.output / 1e6) * price.output)
  return perMillion(off, 1) + perMillion(peak, peakMultiplier)
}
