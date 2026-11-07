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
  // The host reports its own version; the panel shows it so a user can tell
  // which build is actually loaded.
  version: '9.9.9',
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
    showWindow: true,
  },
  // The host's own clock and its pricing-window verdict: the client must not
  // decide either of these for itself.
  hostNow: 1792110729081,
  window: {
    phase: 'peak',
    changesAt: 1792110729081 + 90 * 60 * 1000,
    nextPhase: 'offpeak',
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

/** Translator that interpolates the way the shipped dictionary does. */
const tInterp = (key) => {
  const map = {
    untilPeak: '{time} 后高峰',
    untilOffPeak: '{time} 后空闲',
    peakLabel: '高峰时段',
    offPeakLabel: '空闲时段',
  }
  return map[key] ?? key
}

const wideTree = await render({ wide: true, t: (key) => key })
const wideText = textOf(wideTree)

await check('the collapsed row is one line: balance and today spend only', () => {
  assert.match(wideText, /¥5\.83/, `balance rendered: ${wideText}`)
  assert.match(wideText, /today\s+¥1\.3/, `today spend rendered: ${wideText}`)
  assert.ok(!wideText.includes('¥9.79'), 'the bonus wallet stays in the card')
  assert.ok(!wideText.includes('204.52M'), 'the month total stays in the card')
  assert.ok(String(sandbox.__lastUrl).includes('sessionId=session-test'), 'the current session id is sent to the host')
})

await check('the collapsed rail is an icon with a one-line tooltip', async () => {
  const narrow = await render({ wide: false, t: (key) => key })
  const text = textOf(narrow)
  assert.ok(!text.includes('¥5.83'), 'no inline text in the rail')
  const holder = find(narrow, (node) => node.props?.className === 'dsh-uw dsh-uw_narrow')
  assert.ok(holder, 'narrow holder present')
  const tooltip = String(holder.props.title)
  assert.ok(!tooltip.includes('\n'), `the tooltip stays a single line: ${tooltip}`)
  assert.match(tooltip, /¥5\.83/)
  assert.match(tooltip, /today ¥1\.3/)
  assert.ok(!tooltip.includes('204.52M'), 'the month total is no longer in the tooltip')
})

const rowOf = (tree) =>
  find(tree, (node) => typeof node.props?.className === 'string' && node.props.className.startsWith('dsh-uw_row'))

await check('the summary row is a real button with an expanded state', () => {
  const target = rowOf(wideTree)
  assert.ok(target, 'row found')
  assert.equal(target.type, 'button')
  assert.equal(target.props['aria-expanded'], false)
  assert.equal(typeof target.props.onClick, 'function')
})

await check('hovering opens a compact card, not the whole breakdown', async () => {
  const root = find(wideTree, (node) => node.props?.className === 'dsh-uw')
  assert.ok(root, 'root found')
  root.props.onMouseEnter()
  const hovered = await render({ wide: true, t: (key) => key })
  const text = textOf(hovered)
  assert.match(text, /balance\s+¥5\.83/)
  assert.match(text, /bonus\s+¥9\.79/)
  assert.match(text, /today\s+20\.34M · ¥1\.3/)
  assert.ok(text.includes('hintDetail'), 'the card invites a click for the breakdown')
  for (const hidden of ['input', 'cacheHit', 'byModel', 'thisMonth', 'requests', 'refresh', 'v9.9.9']) {
    assert.ok(!text.includes(hidden), `hover must not show "${hidden}": ${text.slice(0, 240)}`)
  }
})

await check('clicking pins the card and reveals the breakdown', async () => {
  rowOf(await render({ wide: true, t: (key) => key })).props.onClick()
  const pinned = await render({ wide: true, t: (key) => key })
  const text = textOf(pinned)
  assert.ok(text.includes('input'), 'input figure present')
  assert.ok(text.includes('output'), 'output figure present')
  assert.match(text, /cacheHit\s+98%/, `cache hit rate rendered: ${text.slice(0, 240)}`)
  assert.ok(text.includes('byModel'), 'per-model section present')
  assert.ok(text.includes('deepseek-v4-flash-vision-exp'), 'per-model row present')
  assert.match(text, /thisMonth\s+204\.52M · ¥11\.14/, 'month figure present')
  assert.match(text, /requests\s+154/, 'request count present')
  assert.ok(text.includes('currentSession'), 'session section present')
  assert.match(text, /currentSession\s+19\.26M · ¥0\.96/, 'session figure present')
  assert.ok(text.includes('refresh'), 'refresh action present')
  assert.ok(text.includes('v9.9.9'), 'the loaded build version is shown')
})

await check('Escape closes the card again', async () => {
  const holder = find(await render({ wide: true, t: (key) => key }), (node) => node.props?.className === 'dsh-uw')
  assert.ok(holder, 'widget holder found')
  assert.equal(typeof holder.props.onKeyDown, 'function', 'a keyboard handler is attached')
  holder.props.onKeyDown({ key: 'Escape' })
  const collapsed = await render({ wide: true, t: (key) => key })
  const text = textOf(collapsed)
  assert.ok(!text.includes('bonus'), 'the card is closed again')
  assert.match(text, /today\s+¥1\.3/, 'the collapsed row remains')
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
  assert.match(textOf(late), /today\s+¥1\.3/, 'the row still renders after the session arrives')
})

/* `showMonth` is read from the fetched payload, so each case needs a fresh
 * mount rather than a re-render of already-loaded state. The month row lives in
 * the clicked breakdown now, so the card has to be pinned before it exists. */
await check('the month row can be turned off from config', async () => {
  sandbox.__payload = { ...PAYLOAD, pricing: { ...PAYLOAD.pricing, showMonth: false } }
  unmount()
  publishSession('session-toggle')
  rowOf(await render({ wide: true, t: (key) => key })).props.onClick()
  const off = textOf(await render({ wide: true, t: (key) => key }))
  assert.ok(off.includes('requests'), 'the breakdown is open')
  assert.ok(!off.includes('thisMonth'), 'no month row when showMonth is false')
  assert.ok(!off.includes('204.52M'), 'no month figure when showMonth is false')

  sandbox.__payload = PAYLOAD
  unmount()
  publishSession('session-toggle')
  rowOf(await render({ wide: true, t: (key) => key })).props.onClick()
  const on = textOf(await render({ wide: true, t: (key) => key }))
  assert.ok(on.includes('thisMonth'), 'the month row returns when showMonth is true')
  assert.ok(on.includes('204.52M'), 'the month figure returns')
})

/* `showWindow` is read from the fetched payload too. The window row now lives in
 * the hover card rather than on the collapsed line, and the collapsed line only
 * carries a peak dot. */
await check('the pricing window row appears in the card and can be turned off', async () => {
  sandbox.__payload = PAYLOAD
  unmount()
  publishSession('session-window')
  const mounted = await render({ wide: true, t: (key) => key })
  find(mounted, (node) => node.props?.className === 'dsh-uw').props.onMouseEnter()
  const hovered = await render({ wide: true, t: tInterp })
  const text = textOf(hovered)
  assert.match(text, /高峰时段/, `the phase is named in the card: ${text.slice(0, 260)}`)
  assert.match(text, /1h 30m 后空闲/, `the countdown comes from host instants: ${text.slice(0, 260)}`)
  assert.ok(
    find(hovered, (node) => typeof node.props?.className === 'string' && node.props.className.includes('dsh-uw_dot--peak')),
    'the collapsed row marks the peak window with a dot',
  )

  sandbox.__payload = { ...PAYLOAD, pricing: { ...PAYLOAD.pricing, showWindow: false } }
  unmount()
  publishSession('session-window')
  const mountedOff = await render({ wide: true, t: (key) => key })
  find(mountedOff, (node) => node.props?.className === 'dsh-uw').props.onMouseEnter()
  const off = await render({ wide: true, t: tInterp })
  const offText = textOf(off)
  assert.ok(!offText.includes('高峰时段'), 'no window row when showWindow is false')
  assert.ok(
    !find(off, (node) => typeof node.props?.className === 'string' && node.props.className.includes('dsh-uw_dot--peak')),
    'no peak dot when showWindow is false',
  )
  assert.match(offText, /today\s+20\.34M/, 'the today figure stays')

  sandbox.__payload = PAYLOAD
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)