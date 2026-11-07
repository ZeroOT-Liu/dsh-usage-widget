/**
 * Client half of the usage widget: a compact three-line footer in the sidebar.
 *
 * Information is layered so the footer stays readable without hiding what
 * people actually watch:
 *
 *   collapsed  余额 · 赠送 / 时段 · 今日消费 / 本月消费
 *   hover      今日 tokens 与输入、输出、缓存命中、命中率，以及时段倒计时
 *   click      请求数、按模型、当前会话、更新时间与刷新
 *
 * The styling is token-driven so the footer matches the host in both themes,
 * and numbers are tabular so they do not jitter as they change.
 *
 * It renders into `sidebar.footer.action`, the list slot the sidebar shell
 * declares just above Settings, and reads everything from the plugin's own
 * host route — it folds no session events and imports no Harness Client
 * package, so only theme tokens are shared with the host.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-widget',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-usage-widget'
    const ROUTE = '/api/dsh-usage-widget/summary'
    const SLOT = 'sidebar.footer.action'

    const zh = {
      title: '用量与余额',
      balance: '余额',
      bonus: '赠送',
      today: '今日',
      thisMonth: '本月',
      currentSession: '当前会话',
      sessionUnknown: '未选中会话',
      input: '输入',
      inputCached: '缓存命中',
      output: '输出',
      reasoning: '推理',
      cacheHit: '命中率',
      requests: '请求数',
      activeDays: '活跃天数',
      sessions: '会话数',
      cost: '花费',
      byModel: '按模型',
      window: '当前时段',
      peakLabel: '高峰时段',
      offPeakLabel: '空闲时段',
      untilPeak: '{time} 后高峰',
      untilOffPeak: '{time} 后空闲',
      updated: '更新于',
      refresh: '刷新',
      loading: '…',
      error: '读取失败',
      balanceUnavailable: '账号服务不可用',
      balanceSignedOut: '未登录',
      balanceFailed: '余额查询失败',
      unpriced: '未配置单价',
      monthPartial: '本月早期数据可能不完整',
      hintDetail: '点击查看明细',
      collapsedHint: '展开侧边栏查看',
      none: '—',
    }

    const en = {
      title: 'Usage & balance',
      balance: 'Balance',
      bonus: 'Bonus',
      today: 'Today',
      thisMonth: 'This month',
      currentSession: 'This session',
      sessionUnknown: 'No session selected',
      input: 'Input',
      inputCached: 'Cache hit',
      output: 'Output',
      reasoning: 'Reasoning',
      cacheHit: 'Hit rate',
      requests: 'Requests',
      activeDays: 'Active days',
      sessions: 'Sessions',
      cost: 'Cost',
      byModel: 'By model',
      window: 'Current window',
      peakLabel: 'Peak',
      offPeakLabel: 'Off-peak',
      untilPeak: 'peak in {time}',
      untilOffPeak: 'off-peak in {time}',
      updated: 'Updated',
      refresh: 'Refresh',
      loading: '…',
      error: 'Read failed',
      balanceUnavailable: 'Account service unavailable',
      balanceSignedOut: 'Signed out',
      balanceFailed: 'Balance query failed',
      unpriced: 'Unpriced',
      monthPartial: 'Early-month data may be incomplete',
      hintDetail: 'Click for details',
      collapsedHint: 'Expand the sidebar',
      none: '—',
    }

    /*
     * Theme tokens only. Every value falls back so the widget stays legible if
     * a token is ever renamed, and the card shadow comes from the elevation
     * token the host already publishes.
     */
    const css = `
.dsh-uw { position: relative; display: block; min-width: 0; }

/* ---------------------------------------------------------------- footer row */
.dsh-uw_row {
  display: flex; align-items: flex-start; gap: 8px; width: 100%;
  padding: 6px 8px; margin: 0; border: 0; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-xs-13-font-family, inherit);
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  line-height: var(--dsw-font-xs-13-line-height, 20px);
  text-align: left; cursor: pointer;
}
.dsh-uw_row:hover, .dsh-uw_row--open { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.dsh-uw_row:focus-visible { outline: 2px solid var(--dsw-alias-link, #4d6bfe); outline-offset: -2px; }
.dsh-uw_icon { flex: 0 0 auto; display: flex; align-items: center; height: 18px; color: var(--dsw-alias-label-tertiary, currentColor); }
.dsh-uw_lines { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dsh-uw_line {
  display: flex; align-items: center; gap: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-uw_line--main { font-size: var(--dsw-font-xs-13-font-size, 13px); line-height: 18px; }
.dsh-uw_line--dim { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-size: var(--dsw-font-xxs-12-font-size, 12px); line-height: 16px; }
.dsh-uw_label { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_value { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.dsh-uw_value--strong { font-weight: 600; }
.dsh-uw_sep { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); opacity: 0.7; }
.dsh-uw_dim { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-variant-numeric: tabular-nums; }
.dsh-uw_dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_dot--peak { background: var(--dsw-alias-state-warn-label, #d9a441); }
.dsh-uw_pill { display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }

/* ---------------------------------------------------------------- the card */
.dsh-uw_card {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); z-index: 30;
  padding: 12px 12px 10px; border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, rgba(44, 44, 46, 1));
  box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-xs-13-font-family, inherit);
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: var(--dsw-font-xxs-12-line-height, 18px);
  max-height: min(72vh, 460px); overflow-y: auto; overscroll-behavior: contain;
}
.dsh-uw_kv { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.dsh-uw_k { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); white-space: nowrap; }
.dsh-uw_v { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-uw_v--strong { font-weight: 600; }
.dsh-uw_big {
  font-size: 20px; line-height: 26px; font-weight: 600; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.dsh-uw_sub { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh-uw_hr { height: 1px; background: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16)); margin: 9px 0; }
.dsh-uw_time { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh-uw_hint { display: flex; justify-content: flex-end; margin-top: 7px; }
.dsh-uw_hintText { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-size: 10px; }

/* -------------------------------------------------------------- detail block */
.dsh-uw_grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 2px 0 6px; }
.dsh-uw_cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-uw_cellK { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); font-size: 11px; line-height: 15px; }
.dsh-uw_cellV { font-variant-numeric: tabular-nums; font-weight: 500; font-size: 13px; line-height: 18px; }
.dsh-uw_sectionTitle {
  color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1));
  font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; margin: 10px 0 5px;
}
.dsh-uw_models { display: flex; flex-direction: column; gap: 3px; }
.dsh-uw_model { display: flex; justify-content: space-between; gap: 10px; }
.dsh-uw_modelName {
  color: var(--dsw-alias-label-secondary, inherit); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-uw_note { color: var(--dsw-alias-state-warn-label, #d9a441); font-size: 11px; line-height: 16px; margin-top: 6px; }
.dsh-uw_foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 10px; padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16));
}
.dsh-uw_refresh {
  border: 0; background: transparent; cursor: pointer; padding: 1px 6px; border-radius: 6px;
  color: var(--dsw-alias-link, inherit); font: inherit; font-size: 11px;
}
.dsh-uw_refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.dsh-uw_refresh:disabled { opacity: 0.5; cursor: default; }

/* ------------------------------------------------------------ collapsed rail */
.dsh-uw_narrow { display: flex; align-items: center; justify-content: center; padding: 7px 0; }
.dsh-uw_narrow .dsh-uw_icon { color: var(--dsw-alias-label-tertiary, currentColor); }
`

    /* ---------------------------------------------------------------- format */

    function trimFixed(value, decimals) {
      return value.toFixed(decimals).replace(/\.?0+$/, '')
    }

    function formatTokens(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0'
      if (number < 1000) return String(Math.round(number))
      if (number < 1e6) return `${trimFixed(number / 1e3, 1)}K`
      if (number < 1e9) return `${trimFixed(number / 1e6, 2)}M`
      return `${trimFixed(number / 1e9, 2)}B`
    }

    function formatInt(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0'
      return String(Math.round(number))
    }

    function currencySymbol(currency) {
      if (currency === 'USD') return '$'
      if (currency === 'CNY') return '¥'
      return ''
    }

    function formatMoney(value, currency) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      const symbol = currencySymbol(currency)
      if (number === 0) return `${symbol}0`
      const decimals = Math.abs(number) < 0.01 ? 4 : Math.abs(number) < 1 ? 3 : 2
      return `${symbol}${trimFixed(number, decimals)}`
    }

    function formatBalanceWallet(wallet, fallbackCurrency) {
      if (wallet === null || typeof wallet !== 'object') return '—'
      const currency = wallet.currency ?? fallbackCurrency
      const raw = String(wallet.balance ?? '')
      if (raw.length === 0) return '—'
      const number = Number(raw)
      const shown = Number.isFinite(number) ? trimFixed(number, number < 1 ? 4 : 2) : raw
      return `${currencySymbol(currency)}${shown}`
    }

    /** Share of the prompt that was served from cache, as a percentage. */
    function formatPercent(ratio) {
      if (!Number.isFinite(ratio) || ratio < 0) return '—'
      const value = Math.min(1, ratio) * 100
      return `${trimFixed(value, value >= 10 ? 0 : 1)}%`
    }

    function formatClock(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const date = new Date(ms)
      return `${date.getHours() < 10 ? '0' : ''}${date.getHours()}:${date.getMinutes() < 10 ? '0' : ''}${date.getMinutes()}`
    }

    /** Compact countdown, e.g. `2h 05m`, `45m`, `<1m`. */
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0m'
      const minutes = Math.round(ms / 60000)
      if (minutes < 1) return '<1m'
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours === 0) return `${rest}m`
      if (rest === 0) return `${hours}h`
      return `${hours}h ${rest < 10 ? '0' : ''}${rest}m`
    }

    /**
     * Describe the pricing window the host reported.
     *
     * The host decides whether the current window is peak, so nothing here
     * compares clocks or timezones; the browser only turns the two instants it
     * was handed into a countdown, which stays correct even if the machine's
     * own clock or timezone is wrong.
     *
     * @param payload - the summary payload.
     * @param t - translate function.
     * @param elapsedMs - milliseconds since the payload was received, so the
     *   countdown keeps falling between two polls instead of freezing at the
     *   value captured when the host answered.
     * @returns view fields, or null when the window must not be shown.
     */
    function windowView(payload, t, elapsedMs = 0) {
      const window = payload?.window
      if (window === null || typeof window !== 'object') return null
      if (payload?.pricing?.showWindow === false) return null
      const peak = window.phase === 'peak'
      const remaining = Number(window.changesAt) - Number(payload?.hostNow) - Math.max(0, Number(elapsedMs) || 0)
      const countdown = Number.isFinite(remaining) && remaining > 0 ? formatDuration(remaining) : ''
      return {
        peak,
        label: peak ? t('peakLabel') : t('offPeakLabel'),
        countdown,
        nextText:
          countdown.length === 0
            ? ''
            : window.nextPhase === 'peak'
              ? t('untilPeak').replace('{time}', countdown)
              : t('untilOffPeak').replace('{time}', countdown),
      }
    }

    /* -------------------------------------------------------------- wallets */

    /** Split the reported wallets into the topped-up list and the bonus list. */
    function walletGroups(balance, currency) {
      if (balance === null || balance === undefined || balance.status !== 'ready') {
        return { main: [], bonus: [] }
      }
      const toEntry = (wallet) => formatBalanceWallet(wallet, currency)
      return {
        main: (Array.isArray(balance.wallets) ? balance.wallets : []).map(toEntry),
        bonus: (Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []).map(toEntry),
      }
    }

    /** Short status line used wherever the balance figure would sit. */
    function balanceStatusText(balance, t) {
      if (balance === null || balance === undefined) return t('none')
      if (balance.status === 'signed-out') return t('balanceSignedOut')
      if (balance.status === 'unavailable') return t('balanceUnavailable')
      if (balance.status === 'failed') return t('balanceFailed')
      return t('none')
    }

    /* ------------------------------------------------------------ components */

    function UsageIcon(props) {
      const size = props?.size ?? 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', {
          x: 1.6,
          y: 3.4,
          width: 12.8,
          height: 9.2,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', { d: 'M1.6 6.6h12.8', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 11.2, cy: 9.6, r: 1.1, fill: 'currentColor' }),
      )
    }

    function KeyValue(props) {
      return h(
        'div',
        { className: 'dsh-uw_kv' },
        h('span', { className: 'dsh-uw_k' }, props.label),
        h('span', { className: `dsh-uw_v${props.strong ? ' dsh-uw_v--strong' : ''}` }, props.value),
      )
    }

    function Cell(props) {
      return h(
        'div',
        { className: 'dsh-uw_cell' },
        h('span', { className: 'dsh-uw_cellK' }, props.label),
        h('span', { className: 'dsh-uw_cellV' }, props.value),
      )
    }

    /** `17.59M · ¥0.79` — the shape both the today and model figures use. */
    function tokensAndCost(view, currency) {
      if (view === null || view === undefined) return '—'
      return `${formatTokens(view.totalTokens)} · ${formatMoney(view.cost, currency)}`
    }

    /** The pricing-window chip, used on the collapsed line and in the card. */
    function WindowPill(props) {
      const view = props.view
      if (view === null || view === undefined) return null
      return h(
        'span',
        { className: 'dsh-uw_pill' },
        h('span', { className: `dsh-uw_dot${view.peak ? ' dsh-uw_dot--peak' : ''}` }),
        view.label,
      )
    }

    /**
     * The hover card.
     *
     * Hovering answers "where did today's tokens go?"; the per-model and
     * per-session figures stay behind a click because they are what made the
     * old panel a wall of numbers.
     */
    function UsageCard(props) {
      const { data, t, currency, detail, error, busy, sessionId, onRefresh, window: windowInfo } = props
      const today = data?.today ?? null
      const month = data?.month ?? null
      const session = data?.session ?? null
      const timestamp = Number.isFinite(data?.updatedAt) ? formatClock(data.updatedAt) : '—'
      const version = typeof data?.version === 'string' && data.version.length > 0 ? `v${data.version}` : ''

      const rows = [
        h(
          'div',
          { className: 'dsh-uw_kv', key: 'today' },
          h('span', { className: 'dsh-uw_k' }, t('today')),
          h('span', { className: 'dsh-uw_v dsh-uw_v--strong' }, tokensAndCost(today, currency)),
        ),
        h('div', { className: 'dsh-uw_hr', key: 'h1' }),
      ]

      if (today !== null && today !== undefined) {
        const promptTokens = Number(today.inputTokens ?? 0) + Number(today.cacheReadTokens ?? 0)
        rows.push(
          h('div', { className: 'dsh-uw_grid', key: 'grid' }, [
            h(Cell, { key: 'in', label: t('input'), value: formatTokens(today.inputTokens) }),
            h(Cell, { key: 'out', label: t('output'), value: formatTokens(today.outputTokens) }),
            h(Cell, { key: 'cache', label: t('inputCached'), value: formatTokens(today.cacheReadTokens) }),
            h(Cell, {
              key: 'hit',
              label: t('cacheHit'),
              value: formatPercent(promptTokens > 0 ? Number(today.cacheReadTokens ?? 0) / promptTokens : NaN),
            }),
          ]),
        )
        if (today.costComplete === false && Array.isArray(today.unpricedModels) && today.unpricedModels.length > 0) {
          rows.push(
            h('div', { className: 'dsh-uw_note', key: 'unpriced' }, `${t('unpriced')}: ${today.unpricedModels.join(', ')}`),
          )
        }
      }

      if (windowInfo !== null && windowInfo !== undefined) {
        rows.push(
          h(
            'div',
            { className: 'dsh-uw_kv', key: 'window', style: { marginTop: '2px' } },
            h(WindowPill, { view: windowInfo }),
            h('span', { className: 'dsh-uw_time' }, windowInfo.nextText),
          ),
        )
      }

      if (!detail) {
        rows.push(
          h(
            'div',
            { className: 'dsh-uw_hint', key: 'hint' },
            h('span', { className: 'dsh-uw_hintText' }, t('hintDetail')),
          ),
        )
      } else {
        rows.push(h('div', { className: 'dsh-uw_hr', key: 'h2' }))
        rows.push(h(KeyValue, { key: 'req', label: t('requests'), value: formatInt(today?.requests) }))
        if (data?.pricing?.showMonth !== false) {
          rows.push(h(KeyValue, { key: 'month', label: t('thisMonth'), value: tokensAndCost(month, currency) }))
        }
        if (month !== null && month !== undefined && month.complete === false) {
          rows.push(h('div', { className: 'dsh-uw_note', key: 'partial' }, t('monthPartial')))
        }

        const models = Array.isArray(today?.models) ? today.models : []
        if (models.length > 0) {
          rows.push(h('div', { className: 'dsh-uw_sectionTitle', key: 'mh' }, t('byModel')))
          rows.push(
            h(
              'div',
              { className: 'dsh-uw_models', key: 'ml' },
              models.map((entry) =>
                h('div', { className: 'dsh-uw_model', key: entry.model }, [
                  h('span', { className: 'dsh-uw_modelName' }, entry.model),
                  h('span', { className: 'dsh-uw_v' }, tokensAndCost(entry, currency)),
                ]),
              ),
            ),
          )
        }

        // The session block only earns its row when the host resolved one.
        if (sessionId && session !== null && session !== undefined) {
          rows.push(h(KeyValue, { key: 'sess', label: t('currentSession'), value: tokensAndCost(session, currency) }))
        }

        rows.push(
          h(
            'div',
            { className: 'dsh-uw_foot', key: 'foot' },
            h(
              'span',
              { className: 'dsh-uw_time' },
              `${t('updated')} ${timestamp}${version.length > 0 ? ` · ${version}` : ''}`,
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-uw_refresh', onClick: onRefresh, disabled: busy === true },
              t('refresh'),
            ),
          ),
        )
      }

      if (typeof error === 'string' && error.length > 0) {
        rows.push(h('div', { className: 'dsh-uw_note', key: 'err' }, `${t('error')}: ${error}`))
      }

      return h('div', { className: 'dsh-uw_card', role: 'group', 'aria-label': t('title') }, rows)
    }

    /**
     * Footer widget.
     *
     * Three lines collapsed, a two-part card on hover and click. The collapsed
     * rail shows the icon alone and carries a single short line in its tooltip.
     */
    function makeWidget(ctx, boundT) {
      return function UsageWidget(props) {
        const wide = props?.wide !== false
        const translate = (key) => {
          if (typeof props?.t === 'function') {
            try {
              return props.t(key)
            } catch {
              /* fall through to the bound translator */
            }
          }
          return boundT(key)
        }

        const [data, setData] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [open, setOpen] = React.useState(false)
        const pinned = React.useRef(false)
        const [sessionId, setSessionId] = React.useState('')
        // Only ever bumped to force a re-render; the clock itself is read from
        // `Date.now()` so a stalled tick cannot make the countdown lie.
        const [, setTick] = React.useState(0)

        React.useEffect(() => {
          // The host owns the notion of "the session the main view is showing";
          // this plugin only reads that resolution. Cordis refuses property
          // access for any service a plugin did not declare in `inject`
          // ("cannot get property … without inject"), so `uiSession` and
          // `sessions` are both declared above — without them this read throws
          // and the panel would always claim no session is selected.
          const readSessionId = () => {
            try {
              const key = ctx.uiSession.adapter.current.getSnapshot()?.key
              return typeof key === 'string' ? key : ''
            } catch {
              return ''
            }
          }
          const sync = () => setSessionId(readSessionId())
          sync()

          // The conversation shell claims the main view after the sidebar has
          // already rendered, so re-resolve whenever either source changes
          // rather than trusting the value read at mount.
          const candidates = []
          try {
            candidates.push(ctx.uiSession.adapter.current)
          } catch {
            /* the binding source is unavailable in this context */
          }
          try {
            candidates.push(ctx.sessions.list)
          } catch {
            /* the session catalog is unavailable in this context */
          }
          const disposers = []
          for (const candidate of candidates) {
            try {
              if (candidate && typeof candidate.subscribe === 'function') disposers.push(candidate.subscribe(sync))
            } catch {
              /* a source that cannot subscribe simply does not participate */
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose?.()
              } catch {
                /* teardown is best effort */
              }
            }
          }
        }, [])

        const load = React.useCallback(
          async (force) => {
            setBusy(true)
            try {
              const query = sessionId.length > 0 ? `?sessionId=${encodeURIComponent(sessionId)}${force ? '&force=1' : ''}` : force ? '?force=1' : ''
              const response = await fetch(`${ROUTE}${query}`, {
                credentials: 'same-origin',
                headers: { accept: 'application/json' },
              })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              const payload = await response.json()
              if (payload?.ok !== true) throw new Error(payload?.error ?? 'bad payload')
              // Stamp local arrival so the pricing-window countdown can fall
              // between polls without trusting the browser's timezone.
              setData({ ...payload, receivedAt: Date.now() })
              setError(null)
            } catch (cause) {
              setError(String(cause?.message ?? cause))
            } finally {
              setBusy(false)
            }
          },
          [sessionId],
        )

        React.useEffect(() => {
          load(false)
        }, [load])

        const refreshSeconds = Math.max(5, Number(data?.pricing?.refreshSeconds) || 30)
        React.useEffect(() => {
          const timer = setInterval(() => load(false), refreshSeconds * 1000)
          return () => clearInterval(timer)
        }, [load, refreshSeconds])

        // The countdown is only rendered inside the card, so a one-second
        // re-render is only worth paying for while it is open. The same tick
        // re-reads the summary the moment the window boundary is crossed, so
        // the badge flips on time instead of up to one poll late;
        // `refreshedBoundary` keeps a late clock from reloading every second.
        const refreshedBoundary = React.useRef(0)
        React.useEffect(() => {
          if (!open) return undefined
          const timer = setInterval(() => {
            setTick((value) => value + 1)
            const boundary = Number(data?.window?.changesAt)
            if (!Number.isFinite(boundary) || boundary <= 0) return
            const arrivedAt = Number(data?.hostNow) + (Date.now() - Number(data?.receivedAt))
            if (arrivedAt >= boundary && refreshedBoundary.current !== boundary) {
              refreshedBoundary.current = boundary
              load(true)
            }
          }, 1000)
          return () => clearInterval(timer)
        }, [open, data, load])

        const currency = data?.pricing?.currency ?? 'CNY'
        const balance = data?.balance ?? null
        const today = data?.today ?? null
        const month = data?.month ?? null
        const showMonth = data?.pricing?.showMonth !== false
        const elapsed = Number.isFinite(data?.receivedAt) ? Math.max(0, Date.now() - data.receivedAt) : 0
        const windowInfo = windowView(data, translate, elapsed)

        const groups = walletGroups(balance, currency)
        const balanceText =
          groups.main.length > 0
            ? groups.main[0]
            : data === null
              ? translate('loading')
              : balanceStatusText(balance, translate)
        const bonusText = groups.bonus.length > 0 ? groups.bonus[0] : ''

        // Error wins over a stale figure: a failed poll must not keep showing
        // an old number as if it were current.
        const todayText =
          error !== null
            ? translate('error')
            : today === null
              ? translate('loading')
              : formatMoney(today.cost, currency)
        const monthText =
          error !== null ? translate('none') : month === null ? translate('loading') : formatMoney(month.cost, currency)

        const tooltip = [
          `${translate('balance')} ${balanceText}`,
          windowInfo !== null ? windowInfo.label : '',
          `${translate('today')} ${todayText}`,
          `${translate('thisMonth')} ${monthText}`,
        ]
          .filter((part) => part.length > 0)
          .join(' · ')

        if (!wide) {
          return h(
            'div',
            { className: 'dsh-uw dsh-uw_narrow', title: tooltip },
            h('span', { className: 'dsh-uw_icon' }, h(UsageIcon, { size: 16 })),
          )
        }

        const lines = [
          h('span', { className: 'dsh-uw_line dsh-uw_line--main', key: 'bal' }, [
            h('span', { className: 'dsh-uw_label', key: 'l' }, translate('balance')),
            h('span', { className: 'dsh-uw_value dsh-uw_value--strong', key: 'v' }, balanceText),
            bonusText.length > 0 ? h('span', { className: 'dsh-uw_sep', key: 's' }, '·') : null,
            bonusText.length > 0
              ? h('span', { className: 'dsh-uw_dim', key: 'b' }, `${translate('bonus')} ${bonusText}`)
              : null,
          ]),
          h('span', { className: 'dsh-uw_line dsh-uw_line--dim', key: 'today' }, [
            windowInfo !== null ? h(WindowPill, { key: 'w', view: windowInfo }) : null,
            windowInfo !== null ? h('span', { className: 'dsh-uw_sep', key: 's1' }, '·') : null,
            h('span', { className: 'dsh-uw_label', key: 'l' }, translate('today')),
            h('span', { className: 'dsh-uw_dim', key: 'v' }, todayText),
          ]),
          showMonth
            ? h('span', { className: 'dsh-uw_line dsh-uw_line--dim', key: 'month' }, [
                h('span', { className: 'dsh-uw_label', key: 'l' }, translate('thisMonth')),
                h('span', { className: 'dsh-uw_dim', key: 'v' }, monthText),
              ])
            : null,
        ]

        const row = h(
          'button',
          {
            type: 'button',
            className: `dsh-uw_row${open ? ' dsh-uw_row--open' : ''}`,
            'aria-expanded': open,
            'aria-haspopup': 'true',
            'aria-label': translate('title'),
            title: open ? undefined : tooltip,
            onClick: () => {
              if (pinned.current) {
                pinned.current = false
                setOpen(false)
                return
              }
              pinned.current = true
              setOpen(true)
            },
          },
          h('span', { className: 'dsh-uw_icon', key: 'icon' }, h(UsageIcon, { size: 16 })),
          h('span', { className: 'dsh-uw_lines', key: 'lines' }, lines),
        )

        return h(
          'div',
          {
            className: 'dsh-uw',
            onMouseEnter: () => setOpen(true),
            onMouseLeave: () => {
              if (!pinned.current) setOpen(false)
            },
            // Escape is the expected way out of a popup for keyboard users;
            // without it the only exit was clicking the row again.
            onKeyDown: (event) => {
              if (event?.key === 'Escape' && open) {
                pinned.current = false
                setOpen(false)
              }
            },
          },
          open
            ? h(UsageCard, {
                key: 'card',
                data,
                t: translate,
                currency,
                detail: pinned.current,
                error,
                busy,
                sessionId,
                window: windowInfo,
                onRefresh: () => load(true),
              })
            : null,
          row,
        )
      }
    }

    /* ----------------------------------------------------------------- apply */

    function apply(ctx) {
      const boundT = (() => {
        try {
          const bind = ctx.locale?.bind
          if (typeof bind === 'function') return bind.call(ctx.locale, NS)
        } catch {
          /* fall back to the built-in dictionary */
        }
        return (key) => zh[key] ?? en[key] ?? key
      })()

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', NS)
        style.textContent = css
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, `${NS}: styles`)

      ctx.effect(() => {
        if (typeof ctx.locale?.register !== 'function') return undefined
        return ctx.locale.register(NS, { zh, en })
      }, `${NS}: dictionaries`)

      const Widget = makeWidget(ctx, boundT)

      ctx.slots.inject(
        SLOT,
        () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: NS,
              order: 20,
              locale: NS,
            },
            Widget,
          ),
        `${NS}: footer widget`,
      )
    }

    // `sessions` and `uiSession` are required, not optional: Cordis throws on
    // reading an undeclared service property, and the session section reads the
    // host's own main-view resolution from `uiSession`.
    return { inject: ['slots', 'locale', 'sessions', 'uiSession'], apply }
  },
})
