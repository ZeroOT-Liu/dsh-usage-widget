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

/**
 * The published peak windows, as `[startMinute, endMinute)` of Beijing local
 * time. Declared once so the billing decision ({@link isPeak}) and the
 * countdown the widget shows ({@link currentWindow}) can never drift apart.
 */
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

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
  return PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end)
}

/** Beijing-local minute of day and weekday for one moment. */
function beijingClock(timeMs) {
  const shifted = new Date(timeMs + BEIJING_OFFSET_MS)
  return { weekday: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() }
}

/** Beijing-local minute of day for one moment. */
function beijingMinutesOfDay(timeMs) {
  return beijingClock(timeMs).minutes
}

/** Beijing-local midnight that starts the day `dayOffset` days from this one. */
function beijingDayStart(timeMs, dayOffset) {
  const shifted = new Date(timeMs + BEIJING_OFFSET_MS)
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  return midnight + dayOffset * 24 * 60 * 60_000 - BEIJING_OFFSET_MS
}

/**
 * Epoch milliseconds of a Beijing-local minute of day.
 *
 * The target is resolved into the current Beijing day, offset by whole days,
 * rather than "the next occurrence of this minute" — rolling forward implicitly
 * is what silently turned a window end into the next day's window start.
 *
 * @param timeMs - reference moment.
 * @param minuteOfDay - Beijing minute of day to land on.
 * @param dayOffset - whole Beijing days past the reference day.
 * @returns the fractional-millisecond-exact boundary, to the minute.
 */
function beijingMinuteAt(timeMs, minuteOfDay, dayOffset) {
  const shifted = new Date(timeMs + BEIJING_OFFSET_MS)
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  const target = midnight + (dayOffset * 24 * 60 + minuteOfDay) * 60_000
  return target - BEIJING_OFFSET_MS
}

/**
 * Whether the phase changes later on the given Beijing day.
 * @param timeMs - reference moment.
 * @param dayOffset - whole Beijing days past the reference day.
 * @returns true for a future day, or for today once a window start still lies ahead.
 */
function changesLaterOnDay(timeMs, dayOffset) {
  if (dayOffset > 0) return true
  const minutes = beijingMinutesOfDay(timeMs)
  return PEAK_WINDOWS.some(([start]) => start > minutes)
}

/**
 * The Beijing minute of day at which the phase next flips, and how many days
 * out it lies.
 * @param timeMs - reference moment.
 * @returns the target minute of day and its whole-day offset.
 */
function nextTransition(timeMs) {
  for (let dayOffset = 0; dayOffset < 5; dayOffset += 1) {
    const day = new Date(beijingDayStart(timeMs, dayOffset) + BEIJING_OFFSET_MS).getUTCDay()
    if (day === 0 || day === 6) continue
    // A later day always has its first window ahead; today must still have one.
    if (dayOffset > 0) return { minuteOfDay: PEAK_WINDOWS[0][0], dayOffset }
    const start = PEAK_WINDOWS.find(([begin]) => begin > beijingMinutesOfDay(timeMs))
    if (start !== undefined) return { minuteOfDay: start[0], dayOffset }
  }
  // Unreachable: at most two weekend days precede any weekday.
  return { minuteOfDay: PEAK_WINDOWS[0][0], dayOffset: 0 }
}

/**
 * The pricing window that applies *right now*, as a wire-ready description.
 *
 * It answers the three questions someone watching the widget has: which window
 * is in effect, what it costs relative to off-peak, and when it changes. The
 * decision is made from the host's clock and shipped with both instants, so the
 * browser never needs its own clock — or its own timezone — to know whether the
 * current window is peak, and the countdown stays right in any locale.
 *
 * @param timeMs - the moment to describe, epoch milliseconds.
 * @returns the current phase and the next transition.
 */
export function currentWindow(timeMs) {
  const { weekday, minutes } = beijingClock(timeMs)
  const weekend = weekday === 0 || weekday === 6
  const active = PEAK_WINDOWS.find(([start, end]) => minutes >= start && minutes < end)

  if (!weekend && active !== undefined) {
    // Inside a window the phase flips at its end, the same day by construction.
    const [, end] = active
    return { phase: 'peak', changesAt: beijingMinuteAt(timeMs, end, 0), nextPhase: 'offpeak' }
  }

  // Outside a window the phase flips at the next window start — today's later
  // window when one is still ahead, otherwise the next weekday's first window.
  const { minuteOfDay, dayOffset } = nextTransition(timeMs)
  return {
    phase: 'offpeak',
    changesAt: beijingMinuteAt(timeMs, minuteOfDay, dayOffset),
    nextPhase: 'peak',
  }
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
