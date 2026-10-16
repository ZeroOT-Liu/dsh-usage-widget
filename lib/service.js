/**
 * Host-side data service for the widget: today's usage plus account balance.
 *
 * Balance comes from the official account service
 * (`ctx.deepseekAccount.getBalance`), the same call the shipped account page
 * uses, so the plugin never talks to the platform API itself and never sees a
 * credential. It is cached because the platform is an external service and the
 * widget polls.
 *
 * @module dsh-usage-widget/service
 */
import { VERSION } from './config.js'
import { resolveModelKey, modelCost } from './pricing.js'
import { UsageIndex, localDayKey, localMonthKey } from './usage-index.js'

const round6 = (value) => Math.round(value * 1e6) / 1e6

/** Read an optional Cordis service without arming the plugin on it. */
function optionalService(ctx, name) {
  try {
    const service = ctx?.get?.(name)
    return service === undefined || service === null ? null : service
  } catch {
    return null
  }
}

/** Project one accumulated bucket into the wire shape the widget renders. */
export function bucketView(bucket, config) {
  const models = []
  let cost = 0
  let costComplete = true
  const unpricedModels = []

  for (const [model, record] of Object.entries(bucket.models)) {
    const priceKey = resolveModelKey(model, config.models, config.aliases)
    const price = priceKey === null ? null : config.models[priceKey]
    let modelCostValue = null
    if (price === undefined || price === null) {
      costComplete = false
      if (!unpricedModels.includes(model)) unpricedModels.push(model)
    } else {
      modelCostValue = round6(modelCost(record, price, config.peakMultiplier))
      cost += modelCostValue
    }
    models.push({
      model,
      priceKey,
      priced: price !== undefined && price !== null,
      requests: record.requests,
      inputTokens: record.inputTokens,
      cacheReadTokens: record.cacheReadTokens,
      outputTokens: record.outputTokens,
      reasoningTokens: record.reasoningTokens,
      totalTokens: record.inputTokens + record.cacheReadTokens + record.outputTokens,
      cost: modelCostValue,
    })
  }

  models.sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    requests: bucket.requests,
    inputTokens: bucket.inputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    outputTokens: bucket.outputTokens,
    reasoningTokens: bucket.reasoningTokens,
    totalTokens: bucket.inputTokens + bucket.cacheReadTokens + bucket.outputTokens,
    cost: round6(cost),
    costComplete,
    unpricedModels,
    firstMs: bucket.firstMs,
    lastMs: bucket.lastMs,
    models,
  }
}

/**
 * Build the widget's data service.
 * @param options - context, normalized config and logger.
 * @returns the summary reader plus its cache state.
 */
export function createUsageService({ ctx, config, logger = null }) {
  const index = new UsageIndex({
    sessionsDir: config.sessionsDir,
    keepDays: config.keepDays,
    logger,
  })

  let balance = { at: 0, value: null, pending: null }

  const timezoneOffsetSeconds = () => -new Date().getTimezoneOffset() * 60

  /** Read the balance, coalescing concurrent refreshes and errors. */
  async function readBalance(force = false) {
    const age = Date.now() - balance.at
    if (!force && balance.value !== null && age < config.balanceRefreshSeconds * 1000) {
      return { ...balance.value, cached: true, fetchedAt: balance.at }
    }
    if (balance.pending !== null) return balance.pending

    balance.pending = (async () => {
      const account = optionalService(ctx, 'deepseekAccount')
      if (account === null || typeof account.getBalance !== 'function') {
        return { status: 'unavailable' }
      }
      try {
        const result = await account.getBalance({
          version: VERSION,
          locale: config.locale,
          timezoneOffsetSeconds: timezoneOffsetSeconds(),
        })
        if (result === null || result === undefined) return { status: 'signed-out' }
        if (result.status === 'failed') return { status: 'failed' }
        if (result.status === 'ready') {
          return {
            status: 'ready',
            wallets: Array.isArray(result.value) ? result.value : [],
            bonusWallets: Array.isArray(result.bonusWallets) ? result.bonusWallets : [],
          }
        }
        return { status: 'failed', error: `unexpected balance status: ${String(result.status)}` }
      } catch (error) {
        const message = error?.message ?? String(error)
        logger?.warn?.(`[dsh-usage-widget] balance query failed: ${message}`)
        return { status: 'failed', error: message }
      }
    })()

    let value
    try {
      value = await balance.pending
    } finally {
      balance.pending = null
    }
    balance = { at: Date.now(), value, pending: null }
    return { ...value, cached: false, fetchedAt: balance.at }
  }

  /**
   * Compose one summary payload.
   * @param options - optional session id and balance-refresh flag.
   * @returns the JSON-serializable summary.
   */
  async function summary({ sessionId = null, force = false } = {}) {
    await index.refresh()
    const now = Date.now()
    const dayKey = localDayKey(now)
    const monthKey = localMonthKey(now)
    const today = index.bucketFor(dayKey)
    const month = index.monthFor(monthKey)
    const scoped = typeof sessionId === 'string' && sessionId.length > 0
    const session = scoped
      ? (() => {
          const scopedMonth = index.monthFor(monthKey, sessionId)
          return {
            id: sessionId,
            ...bucketView(index.bucketFor(dayKey, sessionId).bucket, config),
            month: {
              ...bucketView(scopedMonth.bucket, config),
              days: scopedMonth.days,
              complete: scopedMonth.complete,
            },
          }
        })()
      : null
    const balanceView = await readBalance(force)

    return {
      ok: true,
      updatedAt: now,
      dayKey,
      monthKey,
      timezoneOffsetSeconds: timezoneOffsetSeconds(),
      today: {
        dayKey,
        sessions: today.sessions,
        ...bucketView(today.bucket, config),
      },
      month: {
        monthKey,
        sessions: month.sessions,
        days: month.days,
        complete: month.complete,
        ...bucketView(month.bucket, config),
      },
      session,
      balance: balanceView,
      pricing: {
        currency: config.currency,
        peakMultiplier: config.peakMultiplier,
        refreshSeconds: config.refreshSeconds,
        balanceRefreshSeconds: config.balanceRefreshSeconds,
        showMonth: config.showMonth,
      },
      diagnostics: index.stats(),
    }
  }

  return { summary, readBalance, index, config }
}
