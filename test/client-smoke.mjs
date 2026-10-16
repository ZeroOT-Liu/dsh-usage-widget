/**
 * Client-half smoke test without a browser.
 *
 * The plugin module is loaded through its real `window.__ModuleLoader__`
 * handshake with a stub `react`, a stub DOM and a stub host context; the
 * registered footer component is then rendered, expanded and asserted on. This
 * catches a crashing component the way the host's own slot renderer would
 * report one, without needing a connected page.
 *
 * The fake context reproduces Cordis's service rule: reading `ctx.<service>`
 * for a service the plugin did not declare in `inject` throws. Forgetting an
 * inject entry therefore fails here instead of silently degrading in the
 * browser — the "未选中会话" bug was exactly that mistake.
 *
 * Run: node test/client-smoke.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

let passed = 0
let failed = 0

/** Awaits the check body, so a failing async assertion is counted, not lost. */
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

/* ------------------------------------------------------- minimal React */

const HOOKS = { states: [], refs: [], deps: [], effects: [], cursor: 0, dirty: false }

function resetHooks() {
  HOOKS.cursor = 0
  HOOKS.pending = []
}

function element(type, props, ...children) {
  const flat = children.length <= 1 ? children[0] : children
  return { type, props: { ...(props ?? {}), children: flat }, __el: true }
}

const React = {
  createElement: element,
  Fragment: 'Fragment',
  useState(initial) {
    const index = HOOKS.cursor++
    if (!(index in HOOKS.states)) HOOKS.states[index] = typeof initial === 'function' ? initial() : initial
    const set = (value) => {
      const next = typeof value === 'function' ? value(HOOKS.states[index]) : value
      if (!Object.is(next, HOOKS.states[index])) {
        HOOKS.states[index] = next
        HOOKS.dirty = true
      }
    }
    return [HOOKS.states[index], set]
  },
  useEffect(fn, deps) {
    const index = HOOKS.cursor++
    const previous = HOOKS.deps[index]
    const changed =
      previous === undefined ||
      deps === undefined ||
      deps.length !== previous.length ||
      deps.some((d, i) => !Object.is(d, previous[i]))
    HOOKS.deps[index] = deps
    if (changed) HOOKS.pending.push(fn)
  },
  useCallback(fn, deps) {
    const index = HOOKS.cursor++
    const previous = HOOKS.deps[index]
    const changed =
      previous === undefined || deps === undefined || deps.some((d, i) => !Object.is(d, previous[i]))
    HOOKS.deps[index] = deps
    if (changed) HOOKS.states[index] = fn
    return HOOKS.states[index] ?? fn
  },
  useRef(initial) {
    const index = HOOKS.cursor++
    if (!(index in HOOKS.refs)) HOOKS.refs[index] = { current: initial }
    return HOOKS.refs[index]
  },
}

/* --------------------------------------------------------- stub host I/O */

const PAYLOAD = {
  ok: true,
  updatedAt: 1792110729081,
  dayKey: '2026-10-16',
  today: {
    dayKey: '2026-10-16',
    sessions: 2,
    requests: 154,
    inputTokens: 328239,
    cacheReadTokens: 19864448,
    outputTokens: 143642,
    reasoningTokens: 0,
    totalTokens: 20336329,
    cost: 1.300096,
    costComplete: true,
    unpricedModels: [],
    models: [
      {
        model: 'deepseek-v4-flash-vision-exp',
        priced: true,
        requests: 154,
        totalTokens: 20336329,
        cost: 1.300096,
        inputTokens: 328239,
        cacheReadTokens: 19864448,
        outputTokens: 143642,
        reasoningTokens: 0,
      },
    ],
  },
  month: {
    monthKey: '2026-10',
    sessions: 7,
    days: 2,
    complete: true,
    requests: 777,
    inputTokens: 3282390,
    cacheReadTokens: 198644480,
    outputTokens: 2592288,
    reasoningTokens: 0,
    totalTokens: 204519158,
    cost: 11.136019,
    costComplete: true,
    unpricedModels: [],
    models: [],
  },
  session: {
    id: 'session-test',
    requests: 121,
    totalTokens: 19257381,
    cost: 0.960464,
    costComplete: true,
    unpricedModels: [],
    models: [],
    month: {
      monthKey: '2026-10',
      sessions: 1,
      days: 1,
      complete: true,
      requests: 700,
      totalTokens: 190000000,
      cost: 10.5,
      costComplete: true,
      unpricedModels: [],
      models: [],
    },
  },
  balance: {
    status: 'ready',
    wallets: [{ currency: 'CNY', balance: '5.8338932400000000' }],
    bonusWallets: [{ currency: 'CNY', balance: '9.7907460000000000' }],
  },
  pricing: {
    currency: 'CNY',
    peakMultiplier: 2,
    refreshSeconds: 30,
    balanceRefreshSeconds: 180,
    showMonth: true,
  },
  diagnostics: {},
}

const styleNodes = []
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        sandbox.__loaded = definition
      },
    },
  },
  document: {
    createElement: () => {
      const node = { textContent: '', attributes: {}, removed: false }
      node.setAttribute = (key, value) => {
        node.attributes[key] = value
      }
      node.remove = () => {
        node.removed = true
      }
      return node
    },
    head: { appendChild: (node) => styleNodes.push(node) },
  },
  fetch: async (url) => ({
    ok: true,
    status: 200,
    async json() {
      sandbox.__lastUrl = url
      // Read through a mutable holder so a test can change the payload.
      return sandbox.__payload
    },
  }),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  console,
  URL,
}
sandbox.globalThis = sandbox
sandbox.window.document = sandbox.document
sandbox.__payload = PAYLOAD

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'dsh-usage-widget/client.js' })

const definition = sandbox.__loaded

await check('module registers itself through the module-loader handshake', () => {
  assert.ok(definition, 'window.__ModuleLoader__.load was called')
  assert.equal(definition.id, 'dsh-usage-widget')
  assert.equal(typeof definition.factory, 'function')
})

const moduleExports = definition.factory((name) => (name === 'react' ? React : undefined))

await check('exports the client plugin contract', () => {
  // The exports come from another vm realm, so compare by structure, not identity.
  // `sessions` and `uiSession` are required: Cordis throws on undeclared reads.
  assert.equal(
    JSON.stringify(Array.from(moduleExports.inject)),
    JSON.stringify(['slots', 'locale', 'sessions', 'uiSession']),
  )
  assert.equal(typeof moduleExports.apply, 'function')
})

/* ------------------------------------------------------------- host stores */

const registrations = []
const cleanups = []

/* `currentValue` starts as the "absent" binding the real host publishes before
 * any conversation claims the main view. */
const listListeners = new Set()
const currentListeners = new Set()
let listSnapshot = { ids: [], byId: {}, phase: 'ready' }
let currentValue = { hooks: {}, keyedHooks: {}, props: {} }

const sessions = {
  list: {
    getSnapshot: () => listSnapshot,
    subscribe: (listener) => {
      listListeners.add(listener)
      return () => listListeners.delete(listener)
    },
  },
}

const uiSession = {
  adapter: {
    current: {
      getSnapshot: () => currentValue,
      subscribe: (listener) => {
        currentListeners.add(listener)
        return () => currentListeners.delete(listener)
      },
    },
  },
}

/** Simulate the conversation shell claiming the main view. */
function publishSession(key) {
  currentValue = { key, hooks: {}, keyedHooks: {}, props: { sessionId: key } }
  listSnapshot = {
    ...listSnapshot,
    ids: [key],
    byId: { [key]: { id: key, retainedBy: { mainView: 1 } } },
  }
  for (const listener of [...currentListeners]) listener()
  for (const listener of [...listListeners]) listener()
}

/**
 * Cordis refuses `ctx.<service>` for any service a plugin did not declare in
 * its `inject` list, so the fake context reproduces that refusal.
 */
function makeCtx(pluginExports, services) {
  const declared = new Set(Array.from(pluginExports.inject ?? []))
  const target = {
    effect(fn) {
      const cleanup = fn()
      cleanups.push(cleanup)
      return cleanup
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    slots: {
      inject(slot, callback) {
        registrations.push({ slot, value: callback() })
      },
      register(options, component) {
        return { options, component }
      },
    },
  }
  return new Proxy(target, {
    get(base, prop, receiver) {
      if (typeof prop === 'symbol' || prop in base) return Reflect.get(base, prop, receiver)
      if (declared.has(prop) && prop in services) return services[prop]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

moduleExports.apply(makeCtx(moduleExports, { sessions, uiSession }))

await check('registers exactly one entry into the sidebar footer slot', () => {
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].slot, 'sidebar.footer.action')
  assert.equal(registrations[0].value.options.id, 'dsh-usage-widget')
  assert.equal(registrations[0].value.options.name, 'sidebar.footer.action')
})

/* --------------------------------------------------------------- rendering */

/**
 * Render an element tree to text.
 *
 * Function components are invoked, so content that arrives through a component
 * (the expanded panel) is actually asserted on instead of silently skipped —
 * reading only `props.children` would report an empty panel as passing. This
 * plugin's child components are hook-free; each component still gets its own
 * hook scope so a future one that uses hooks keeps working.
 */
const CHILD_SCOPES = new Map()

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (!node.__el) return ''
  const { type, props } = node
  if (typeof type === 'function') {
    let scope = CHILD_SCOPES.get(type)
    if (scope === undefined) {
      scope = { states: [], refs: [], deps: [], pending: [], cursor: 0, dirty: false }
      CHILD_SCOPES.set(type, scope)
    }
    const caller = { ...HOOKS }
    Object.assign(HOOKS, scope)
    try {
      return textOf(type(props))
    } finally {
      for (const key of Object.keys(scope)) scope[key] = HOOKS[key]
      Object.assign(HOOKS, caller)
    }
  }
  return textOf(props?.children)
}

function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (node.__el) {
    if (predicate(node)) return node
    return find(node.props?.children, predicate)
  }
  return null
}

const Widget = registrations[0].value.component

/** Render to a stable tree, letting effects and their async state settle. */
async function render(props, passes = 8) {
  let tree = null
  for (let pass = 0; pass < passes; pass += 1) {
    resetHooks()
    HOOKS.dirty = false
    tree = Widget(props)
    for (const effect of HOOKS.pending) effect()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!HOOKS.dirty) break
  }
  return tree
}

/** Drop all hook state and host subscriptions so the next render is a mount. */
function unmount() {
  HOOKS.states = []
  HOOKS.refs = []
  HOOKS.deps = []
  HOOKS.pending = []
  HOOKS.cursor = 0
  HOOKS.dirty = false
  currentListeners.clear()
  listListeners.clear()
}

// The conversation shell has claimed the main view, which is the normal case.
publishSession('session-test')

const wideTree = await render({ wide: true, t: (key) => key })
const wideText = textOf(wideTree)

await check('wide footer row shows balance, bonus, today and month totals', () => {
  assert.match(wideText, /balance\s+¥5\.83/, `balance rendered: ${wideText}`)
  assert.match(wideText, /bonus\s+¥9\.79/, 'bonus wallet is visible without expanding')
  assert.match(wideText, /today\s+20\.34M tokens · ¥1\.3/, 'today line rendered')
  assert.match(wideText, /thisMonth\s+204\.52M tokens · ¥11\.14/, 'month line is visible without expanding')
  assert.ok(String(sandbox.__lastUrl).includes('sessionId=session-test'), 'the current session id is sent to the host')
})

await check('collapsed rail collapses to an icon carrying the full summary', async () => {
  const narrow = await render({ wide: false, t: (key) => key })
  const text = textOf(narrow)
  assert.ok(!text.includes('20.34M'), 'no inline text in the rail')
  const holder = find(narrow, (node) => node.props?.className === 'dsh-uw dsh-uw_narrow')
  assert.ok(holder, 'narrow holder present')
  const tooltip = String(holder.props.title)
  assert.match(tooltip, /balance: ¥5\.83 · bonus ¥9\.79/, `bonus in the collapsed tooltip: ${tooltip}`)
  assert.match(tooltip, /today: 20\.34M tokens · ¥1\.3/)
  assert.match(tooltip, /thisMonth: 204\.52M tokens · ¥11\.14/, `month in the collapsed tooltip: ${tooltip}`)
  assert.ok(!/today: today/.test(tooltip), 'the tooltip does not label the row twice')
})

const clickTarget = find(wideTree, (node) => node.props?.className === 'dsh-uw_row')

await check('the summary row is a real button with an expanded state', () => {
  assert.ok(clickTarget, 'row found')
  assert.equal(clickTarget.type, 'button')
  assert.equal(clickTarget.props['aria-expanded'], false)
  assert.equal(typeof clickTarget.props.onClick, 'function')
})

await check('clicking expands a panel with balance, month, per-model and session detail', async () => {
  clickTarget.props.onClick()
  const expanded = await render({ wide: true, t: (key) => key })
  const text = textOf(expanded)
  assert.ok(text.includes('todayUsage'), 'panel title present')
  assert.ok(text.includes('deepseek-v4-flash-vision-exp'), 'per-model row present')
  assert.ok(text.includes('¥9.79'), 'bonus wallet rendered')
  assert.ok(text.includes('¥5.83'), 'main wallet rendered')
  assert.ok(text.includes('session-test') || text.includes('currentSession'), 'current session section present')
  assert.ok(text.includes('refresh'), 'refresh action present')
  assert.ok(text.includes('20.34M · ¥1.3'), `per-model tokens and cost rendered: ${text.slice(0, 200)}`)

  // Month section: the cumulative figures, and its own day/session counts.
  assert.ok(text.includes('monthUsage'), 'month section title present')
  assert.ok(text.includes('2026-10'), 'month key present')
  assert.ok(text.includes('204519158'), 'month token total present')
  assert.ok(text.includes('¥11.14'), 'month cost present')
  assert.ok(text.includes('777'), 'month request count present')
  assert.ok(text.includes('activeDays'), 'active-day count labelled')
  assert.ok(text.includes('190M · ¥10.5'), 'the current session month figure is shown')
})

await check('the stylesheet is injected and its cleanup removes it', () => {
  assert.equal(styleNodes.length, 1)
  const style = styleNodes[0]
  assert.equal(style.attributes['data-dsh-plugin'], 'dsh-usage-widget')
  assert.match(style.textContent, /\.dsh-uw_row/)
  const styleCleanup = cleanups[0]
  assert.equal(typeof styleCleanup, 'function')
  styleCleanup()
  assert.equal(style.removed, true, 'the style node is removed on teardown')
})

/* Regression: the sidebar renders before the conversation shell claims the
 * main view, so at mount the host still publishes its "absent" binding. The
 * widget must re-resolve when the session appears instead of keeping the empty
 * id — that was the "未选中会话" bug. */
await check('re-resolves the current session when it appears after mount', async () => {
  unmount()
  currentValue = { hooks: {}, keyedHooks: {}, props: {} }
  listSnapshot = { ids: [], byId: {}, phase: 'ready' }
  sandbox.__lastUrl = ''

  await render({ wide: true, t: (key) => key })
  assert.ok(!String(sandbox.__lastUrl).includes('sessionId='), 'no session id is sent before one is selected')

  publishSession('session-late')
  const late = await render({ wide: true, t: (key) => key })
  assert.ok(
    String(sandbox.__lastUrl).includes('sessionId=session-late'),
    `the late session is picked up: ${sandbox.__lastUrl}`,
  )
  assert.ok(textOf(late).includes('20.34M'), 'the row still renders after the session arrives')
})

/* `showMonth` is read from the fetched payload, so each case needs a fresh
 * mount rather than a re-render of already-loaded state. */
await check('the month line can be turned off from config', async () => {
  sandbox.__payload = { ...PAYLOAD, pricing: { ...PAYLOAD.pricing, showMonth: false } }
  unmount()
  publishSession('session-toggle')
  const off = await render({ wide: true, t: (key) => key })
  assert.ok(textOf(off).includes('20.34M'), 'today line still rendered')
  assert.ok(!textOf(off).includes('204.52M'), 'no month line when showMonth is false')

  sandbox.__payload = PAYLOAD
  unmount()
  publishSession('session-toggle')
  const on = await render({ wide: true, t: (key) => key })
  assert.ok(textOf(on).includes('204.52M'), 'month line returns when showMonth is true')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)