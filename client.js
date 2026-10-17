/**
 * Client half of the usage widget: a footer row at the bottom of the sidebar.
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
      todayUsage: '今日用量',
      thisMonth: '本月',
      monthUsage: '本月累计',
      activeDays: '活跃天数',
      monthPartial: '本月早期数据超出保留窗口，可能不完整',
      currentSession: '当前会话',
      sessionUnknown: '未选中会话',
      tokens: 'tokens',
      totalTokens: '总 tokens',
      input: '输入',
      inputCached: '输入（缓存命中）',
      output: '输出',
      reasoning: '其中推理',
      requests: '请求数',
      sessions: '会话数',
      cost: '花费',
      byModel: '按模型',
      noData: '今日暂无用量',
      updated: '更新于',
      refresh: '刷新',
      loading: '加载中…',
      error: '读取失败',
      balanceUnavailable: '账号服务不可用',
      balanceSignedOut: '未登录',
      balanceFailed: '余额查询失败',
      unpriced: '未配置单价，未计入花费',
      window: '当前时段',
      peakLabel: '高峰时段',
      offPeakLabel: '空闲时段',
      switchIn: '距切换',
      windowHint: '高峰单价 ×{multiplier}（北京时间 周一至周五 9:00–12:00、14:00–18:00），其余时段按半价',
      collapsedHint: '展开侧边栏查看明细',
      none: '—',
    }

    const en = {
      title: 'Usage & balance',
      balance: 'Balance',
      bonus: 'Bonus',
      today: 'Today',
      todayUsage: 'Today usage',
      thisMonth: 'This month',
      monthUsage: 'Month to date',
      activeDays: 'Active days',
      monthPartial: 'Early-month data is past the retention window; the total may be short',
      currentSession: 'Current session',
      sessionUnknown: 'No session selected',
      tokens: 'tokens',
      totalTokens: 'Total tokens',
      input: 'Input',
      inputCached: 'Input (cache hit)',
      output: 'Output',
      reasoning: 'of which reasoning',
      requests: 'Requests',
      sessions: 'Sessions',
      cost: 'Cost',
      byModel: 'By model',
      noData: 'No usage today',
      updated: 'Updated',
      refresh: 'Refresh',
      loading: 'Loading…',
      error: 'Read failed',
      balanceUnavailable: 'Account service unavailable',
      balanceSignedOut: 'Signed out',
      balanceFailed: 'Balance query failed',
      unpriced: 'No price configured; excluded from cost',
      window: 'Current window',
      peakLabel: 'Peak',
      offPeakLabel: 'Off-peak',
      switchIn: 'switches in',
      windowHint: 'Peak prices are ×{multiplier} (Beijing time, Mon–Fri 09:00–12:00 and 14:00–18:00); other hours are half price',
      collapsedHint: 'Expand the sidebar for details',
      none: '—',
    }

    const css = `
.dsh-uw { position: relative; display: block; min-width: 0; }
.dsh-uw_row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; margin: 0; border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-xs-13-font-family, inherit);
  font-size: var(--dsw-font-xs-13-font-size, 12px);
  line-height: var(--dsw-font-xs-13-line-height, 1.4);
  text-align: left; cursor: pointer;
}
.dsh-uw_row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); }
.dsh-uw_row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -2px; }
.dsh-uw_icon { flex: 0 0 auto; display: flex; align-items: center; color: var(--dsw-alias-label-secondary, currentColor); }
.dsh-uw_lines { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-uw_line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-uw_line--dim { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_sep { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_line--alert { color: var(--dsw-alias-state-warn-label, #d9a441); }
/* The live peak/off-peak badge: an inline chip that keeps the window visible
   while the footer is collapsed. Peak is the exception that costs more, so it
   takes the warning colour and off-peak stays quiet. */
.dsh-uw_badge {
  display: inline-block; margin-right: 4px; padding: 0 4px; border-radius: var(--dsw-radius-xs, 4px);
  font-size: calc(var(--dsw-font-xs-13-font-size, 12px) - 1px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
}
.dsh-uw_badge--peak { color: var(--dsw-alias-state-warn-label, #d9a441); }
.dsh-uw_badge--offpeak { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_badgeValue { font-variant-numeric: tabular-nums; }
.dsh-uw_hint { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_narrow { display: flex; align-items: center; justify-content: center; padding: 6px 0; }
.dsh-uw_panel {
  margin: 0 0 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, rgba(40, 40, 40, 1));
  box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.3));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-xs-13-font-family, inherit);
  font-size: var(--dsw-font-xs-13-font-size, 12px);
  line-height: var(--dsw-font-xs-13-line-height, 1.4);
}
.dsh-uw_head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-uw_headTitle { font-weight: 600; }
.dsh-uw_headDay { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_group { display: flex; flex-direction: column; gap: 3px; }
.dsh-uw_groupTitle { color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_kv { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-uw_k { color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
.dsh-uw_v { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-uw_v--strong { font-weight: 600; }
.dsh-uw_divider { height: 1px; background: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2)); }
.dsh-uw_models { display: flex; flex-direction: column; gap: 2px; }
.dsh-uw_model { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-uw_modelName { color: var(--dsw-alias-label-secondary, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-uw_foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary, rgba(150, 150, 150, 1)); }
.dsh-uw_refresh {
  border: 0; background: transparent; cursor: pointer; padding: 2px 4px; border-radius: var(--dsw-radius-xs, 4px);
  color: var(--dsw-alias-link, inherit); font: inherit;
}
.dsh-uw_refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)); }
.dsh-uw_note { color: var(--dsw-alias-state-warn-label, #d9a441); }
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
     * @returns view fields, or null when the window must not be shown.
     */
    function windowView(payload, t) {
      const window = payload?.window
      if (window === null || typeof window !== 'object') return null
      if (payload?.pricing?.showWindow === false) return null
      const peak = window.phase === 'peak'
      const multiplier = Number(payload?.pricing?.peakMultiplier)
      const remaining = Number(window.changesAt) - Number(payload?.hostNow)
      return {
        peak,
        label: peak ? t('peakLabel') : t('offPeakLabel'),
        // Peak is the only window that costs more, so it is the only one worth
        // showing a multiplier for in the badge itself.
        badgeText: peak && Number.isFinite(multiplier) ? `×${trimFixed(multiplier, 2)}` : '',
        multiplierText: Number.isFinite(multiplier) ? `×${trimFixed(multiplier, 2)}` : '—',
        nextLabel: window.nextPhase === 'peak' ? t('peakLabel') : t('offPeakLabel'),
        countdown: Number.isFinite(remaining) && remaining > 0 ? formatDuration(remaining) : '',
        hint: t('windowHint').replace('{multiplier}', Number.isFinite(multiplier) ? trimFixed(multiplier, 2) : '2'),
      }
    }

    /** The inline chip that keeps the current window visible while collapsed. */
    function WindowBadge(props) {
      const view = props.view
      if (view === null || view === undefined) return null
      return h(
        'span',
        { className: `dsh-uw_badge dsh-uw_badge--${view.peak ? 'peak' : 'offpeak'}` },
        view.label,
        view.badgeText.length > 0 ? h('span', { className: 'dsh-uw_badgeValue' }, ` ${view.badgeText}`) : null,
      )
    }

    /**
     * Every wallet as `{ label, value }` parts: the topped-up balance first,
     * then each bonus wallet. The bonus is spendable too, so it belongs in the
     * collapsed summary rather than only in the expanded panel.
     */
    function walletParts(balance, currency, t) {
      if (balance === null || balance === undefined) return [{ label: null, value: t('none') }]
      if (balance.status !== 'ready') {
        const status =
          balance.status === 'signed-out'
            ? t('balanceSignedOut')
            : balance.status === 'unavailable'
              ? t('balanceUnavailable')
              : t('balanceFailed')
        return [{ label: null, value: status }]
      }
      const parts = []
      for (const wallet of Array.isArray(balance.wallets) ? balance.wallets : []) {
        parts.push({ label: null, value: formatBalanceWallet(wallet, currency) })
      }
      for (const wallet of Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []) {
        parts.push({ label: t('bonus'), value: formatBalanceWallet(wallet, currency) })
      }
      return parts.length > 0 ? parts : [{ label: null, value: t('none') }]
    }

    /** Flat text form of {@link walletParts}, for tooltips. */
    function walletText(parts) {
      return parts.map((part) => (part.label === null ? part.value : `${part.label} ${part.value}`)).join(' · ')
    }

    /* ------------------------------------------------------------ component */

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

    /** One day's usage block, shared by the total and the current session. */
    function UsageBlock(props) {
      const { view, t, currency, compact } = props
      if (view === null || view === undefined) {
        return h('div', { className: 'dsh-uw_kv' }, h('span', { className: 'dsh-uw_k' }, t('noData')))
      }
      const children = [
        h(KeyValue, {
          key: 'total',
          strong: true,
          label: t('totalTokens'),
          value: formatInt(view.totalTokens),
        }),
        h(KeyValue, { key: 'in', label: t('input'), value: formatInt(view.inputTokens) }),
        h(KeyValue, { key: 'cached', label: t('inputCached'), value: formatInt(view.cacheReadTokens) }),
        h(KeyValue, { key: 'out', label: t('output'), value: formatInt(view.outputTokens) }),
        h(KeyValue, { key: 'reason', label: t('reasoning'), value: formatInt(view.reasoningTokens) }),
        h(KeyValue, { key: 'cost', strong: true, label: t('cost'), value: formatMoney(view.cost, currency) }),
        h(KeyValue, { key: 'req', label: t('requests'), value: formatInt(view.requests) }),
      ]
      if (!compact && Number.isFinite(view.sessions)) {
        children.push(h(KeyValue, { key: 'sess', label: t('sessions'), value: formatInt(view.sessions) }))
      }
      if (view.costComplete === false && Array.isArray(view.unpricedModels) && view.unpricedModels.length > 0) {
        children.push(
          h('div', { key: 'unpriced', className: 'dsh-uw_note' }, `${t('unpriced')}: ${view.unpricedModels.join(', ')}`),
        )
      }
      return h('div', { className: 'dsh-uw_group' }, children)
    }

    /**
     * Month-to-date totals. Only the figures that are meaningful cumulatively
     * are shown — the full input/output breakdown already exists for today, and
     * repeating it would bury the two numbers the section exists for.
     */
    function MonthBlock(props) {
      const { view, t, currency } = props
      if (view === null || view === undefined) {
        return h(KeyValue, { label: t('totalTokens'), value: t('none') })
      }
      const children = [
        h(KeyValue, { key: 'total', strong: true, label: t('totalTokens'), value: formatInt(view.totalTokens) }),
        h(KeyValue, { key: 'cost', strong: true, label: t('cost'), value: formatMoney(view.cost, currency) }),
        h(KeyValue, { key: 'req', label: t('requests'), value: formatInt(view.requests) }),
        h(KeyValue, { key: 'days', label: t('activeDays'), value: formatInt(view.days) }),
        h(KeyValue, { key: 'sess', label: t('sessions'), value: formatInt(view.sessions) }),
      ]
      if (view.complete === false) {
        children.push(h('div', { key: 'partial', className: 'dsh-uw_note' }, t('monthPartial')))
      }
      if (view.costComplete === false && Array.isArray(view.unpricedModels) && view.unpricedModels.length > 0) {
        children.push(
          h('div', { key: 'unpriced', className: 'dsh-uw_note' }, `${t('unpriced')}: ${view.unpricedModels.join(', ')}`),
        )
      }
      return h('div', { className: 'dsh-uw_group' }, children)
    }

    function BalanceBlock(props) {
      const { balance, t, currency } = props
      if (balance === null || balance === undefined) return null
      if (balance.status !== 'ready') {
        const label =
          balance.status === 'signed-out'
            ? t('balanceSignedOut')
            : balance.status === 'unavailable'
              ? t('balanceUnavailable')
              : t('balanceFailed')
        return h(KeyValue, { label: t('balance'), value: label })
      }
      const wallets = Array.isArray(balance.wallets) ? balance.wallets : []
      const bonus = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
      const children = []
      if (wallets.length === 0) {
        children.push(h(KeyValue, { key: 'none', strong: true, label: t('balance'), value: t('none') }))
      }
      for (const wallet of wallets) {
        children.push(
          h(KeyValue, {
            key: `w-${wallet.currency ?? 'x'}`,
            strong: true,
            label: t('balance'),
            value: formatBalanceWallet(wallet, currency),
          }),
        )
      }
      for (const wallet of bonus) {
        children.push(
          h(KeyValue, {
            key: `b-${wallet.currency ?? 'x'}`,
            label: t('bonus'),
            value: formatBalanceWallet(wallet, currency),
          }),
        )
      }
      return h('div', { className: 'dsh-uw_group' }, children)
    }

    /** The pricing window in force, with the countdown to the next one. */
    function WindowBlock(props) {
      const { view, t } = props
      if (view === null || view === undefined) return null
      const children = [
        h(KeyValue, { key: 'phase', strong: true, label: t('window'), value: view.label }),
        h(KeyValue, { key: 'mult', label: t('peakLabel'), value: view.multiplierText }),
      ]
      if (view.countdown.length > 0) {
        children.push(
          h(KeyValue, { key: 'next', label: t('switchIn'), value: `${view.countdown} → ${view.nextLabel}` }),
        )
      }
      children.push(h('div', { key: 'hint', className: 'dsh-uw_hint' }, view.hint))
      return h('div', { className: 'dsh-uw_group' }, children)
    }

    function UsagePanel(props) {
      const { data, t, currency, sessionId, onRefresh, busy } = props
      const today = data?.today ?? null
      const session = data?.session ?? null
      const models = Array.isArray(today?.models) ? today.models : []
      const timestamp = Number.isFinite(data?.updatedAt) ? formatClock(data.updatedAt) : '—'
      const windowInfo = windowView(data, t)

      const groups = [
        h('div', { className: 'dsh-uw_head', key: 'head' }, [
          h('span', { className: 'dsh-uw_headTitle', key: 'title' }, t('todayUsage')),
          h('span', { className: 'dsh-uw_headDay', key: 'day' }, today?.dayKey ?? ''),
        ]),
        h('div', { key: 'balance' }, h(BalanceBlock, { balance: data?.balance, t, currency })),
        windowInfo === null ? null : h('div', { className: 'dsh-uw_divider', key: 'd0' }),
        windowInfo === null ? null : h('div', { key: 'window' }, h(WindowBlock, { view: windowInfo, t })),
        h('div', { className: 'dsh-uw_divider', key: 'd1' }),
        h('div', { key: 'today' }, h(UsageBlock, { view: today, t, currency })),
      ]

      if (models.length > 0) {
        groups.push(h('div', { className: 'dsh-uw_divider', key: 'd2' }))
        groups.push(
          h(
            'div',
            { className: 'dsh-uw_group', key: 'models' },
            [
              h('div', { className: 'dsh-uw_groupTitle', key: 'h' }, t('byModel')),
              h(
                'div',
                { className: 'dsh-uw_models', key: 'list' },
                models.map((entry) =>
                  h('div', { className: 'dsh-uw_model', key: entry.model }, [
                    h('span', { className: 'dsh-uw_modelName', key: 'n' }, entry.model),
                    h(
                      'span',
                      { className: 'dsh-uw_v', key: 'v' },
                      `${formatTokens(entry.totalTokens)} · ${entry.priced ? formatMoney(entry.cost, currency) : t('none')}`,
                    ),
                  ]),
                ),
              ),
            ],
          ),
        )
      }

      groups.push(h('div', { className: 'dsh-uw_divider', key: 'd3' }))
      const month = data?.month ?? null
      const showMonth = data?.pricing?.showMonth !== false
      if (showMonth) {
        groups.push(
          h('div', { className: 'dsh-uw_group', key: 'month' }, [
            h(
              'div',
              { className: 'dsh-uw_groupTitle', key: 'h' },
              `${t('monthUsage')}${month?.monthKey ? ` · ${month.monthKey}` : ''}`,
            ),
            h(MonthBlock, { view: month, t, currency }),
          ]),
        )
        groups.push(h('div', { className: 'dsh-uw_divider', key: 'd4' }))
      }

      groups.push(
        h('div', { className: 'dsh-uw_group', key: 'session' }, [
          h(
            'div',
            { className: 'dsh-uw_groupTitle', key: 'h' },
            sessionId ? `${t('currentSession')}` : t('sessionUnknown'),
          ),
          sessionId ? h(UsageBlock, { view: session, t, currency, compact: true }) : null,
          sessionId && session?.month !== undefined && session.month !== null
            ? h(KeyValue, {
                key: 'smonth',
                label: t('thisMonth'),
                value: `${formatTokens(session.month.totalTokens)} · ${formatMoney(session.month.cost, currency)}`,
              })
            : null,
        ]),
      )

      groups.push(
        h('div', { className: 'dsh-uw_foot', key: 'foot' }, [
          h('span', { key: 'ts' }, `${t('updated')} ${timestamp}`),
          h(
            'button',
            { type: 'button', className: 'dsh-uw_refresh', onClick: onRefresh, key: 'btn', disabled: busy === true },
            t('refresh'),
          ),
        ]),
      )

      if (typeof data?.error === 'string' && data.error.length > 0) {
        groups.push(h('div', { className: 'dsh-uw_note', key: 'err' }, `${t('error')}: ${data.error}`))
      }

      return h('div', { className: 'dsh-uw_panel', role: 'group', 'aria-label': t('title') }, groups)
    }

    /**
     * Footer widget. Wide sidebar: two summary lines plus an expandable panel.
     * Collapsed rail: the icon alone, with the full summary in its tooltip.
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
              setData(payload)
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

        const currency = data?.pricing?.currency ?? 'CNY'
        const today = data?.today ?? null
        const month = data?.month ?? null
        const showMonth = data?.pricing?.showMonth !== false
        const balance = data?.balance ?? null
        // The current pricing window, or null when the host did not report one
        // (an older host half) or the user turned the badge off.
        const windowInfo = windowView(data, translate)

        const balanceWalletParts = walletParts(balance, currency, translate)
        const balanceText = walletText(balanceWalletParts)

        // Shared figure text; callers add the label so the tooltip never
        // prefixes it twice.
        const figure = (view) =>
          `${formatTokens(view.totalTokens)} ${translate('tokens')} · ${formatMoney(view.cost, currency)}`

        // Computed only when there is a day to describe: `figure` dereferences
        // the view, so a null `today` must not reach it.
        const todayText = today === null ? '' : `${translate('today')} ${figure(today)}`
        const summaryLine = today
          ? todayText
          : error !== null
            ? `${translate('error')}`
            : translate('loading')
        // The badge rides the today line so the window stays visible in the
        // collapsed footer, where there is no room for a fourth line.
        const summaryChildren =
          today !== null && windowInfo !== null
            ? [h(WindowBadge, { key: 'window', view: windowInfo }), h('span', { key: 'text' }, todayText)]
            : summaryLine

        const monthFigure = showMonth && month !== null ? figure(month) : null
        const monthLine = monthFigure === null ? null : `${translate('thisMonth')} ${monthFigure}`

        const tooltip = [
          `${translate('balance')}: ${balanceText}`,
          ...(windowInfo === null
            ? []
            : [
                `${translate('window')}: ${windowInfo.label}${windowInfo.badgeText.length > 0 ? ` ${windowInfo.badgeText}` : ''}${
                  windowInfo.countdown.length > 0 ? ` · ${translate('switchIn')} ${windowInfo.countdown}` : ''
                }`,
              ]),
          `${translate('today')}: ${today === null ? summaryLine : figure(today)}`,
          ...(monthFigure === null ? [] : [`${translate('thisMonth')}: ${monthFigure}`]),
          translate('collapsedHint'),
        ].join('\n')

        if (!wide) {
          return h(
            'div',
            { className: 'dsh-uw dsh-uw_narrow', title: tooltip },
            h('span', { className: 'dsh-uw_icon' }, h(UsageIcon, { size: 16 })),
          )
        }

        // The topped-up balance leads and stays primary; each bonus wallet
        // follows in a dimmed span so both are legible without expanding.
        const balanceLineChildren = [h('span', { key: 'label' }, `${translate('balance')} `)]
        balanceWalletParts.forEach((part, index) => {
          if (index > 0) balanceLineChildren.push(h('span', { className: 'dsh-uw_sep', key: `sep-${index}` }, ' · '))
          balanceLineChildren.push(
            h(
              'span',
              { className: part.label === null ? undefined : 'dsh-uw_line--dim', key: `wallet-${index}` },
              part.label === null ? part.value : `${part.label} ${part.value}`,
            ),
          )
        })

        const rowChildren = [
          h('span', { className: 'dsh-uw_icon', key: 'icon' }, h(UsageIcon, { size: 16 })),
          h('span', { className: 'dsh-uw_lines', key: 'lines' }, [
            h('span', { className: 'dsh-uw_line', key: 'b' }, balanceLineChildren),
            h('span', { className: `dsh-uw_line${error !== null ? ' dsh-uw_line--alert' : ' dsh-uw_line--dim'}`, key: 't' }, summaryChildren),
            monthLine === null ? null : h('span', { className: 'dsh-uw_line dsh-uw_line--dim', key: 'm' }, monthLine),
          ]),
        ]

        return h(
          'div',
          {
            className: 'dsh-uw',
            onMouseEnter: () => setOpen(true),
            onMouseLeave: () => {
              if (!pinned.current) setOpen(false)
            },
          },
          open
            ? h(UsagePanel, {
                data: data === null ? null : { ...data, error },
                t: translate,
                currency,
                sessionId,
                busy,
                onRefresh: () => load(true),
              })
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-uw_row',
              'aria-expanded': open,
              'aria-label': translate('title'),
              title: open ? undefined : tooltip,
              onClick: () => {
                pinned.current = !pinned.current
                setOpen(pinned.current ? true : false)
              },
            },
            rowChildren,
          ),
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
    // reading an undeclared service property, and the current-session section
    // reads the host's own main-view resolution from `uiSession`.
    return { inject: ['slots', 'locale', 'sessions', 'uiSession'], apply }
  },
})
