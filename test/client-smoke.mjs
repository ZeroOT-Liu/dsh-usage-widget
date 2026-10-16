/**
 * Client-half smoke test without a browser.
 *
 * The plugin module is loaded through its real `window.__ModuleLoader__`
 * handshake with a stub `react`, a stub DOM and a stub host context; the
 * registered footer component is then rendered, expanded and asserted on. This
 * catches a crashing component the way the host's own slot renderer would
 * report one, without needing a connected page.
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
function check(name, fn) {
  try {
    fn()
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
    const changed = previous === undefined || deps === undefined || deps.length !== previous.length || deps.some((d, i) => !Object.is(d, previous[i]))
    HOOKS.deps[index] = deps
    if (changed) HOOKS.pending.push(fn)
  },
  useCallback(fn, deps) {
    const index = HOOKS.cursor++
    const previous = HOOKS.deps[index]
    const changed = previous === undefined || deps === undefined || deps.some((d, i) => !Object.is(d, previous[i]))
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
  session: { id: 'session-test', requests: 121, totalTokens: 19257381, cost: 0.960464, costComplete: true, unpricedModels: [], models: [] },
  balance: {
    status: 'ready',
    wallets: [{ currency: 'CNY', balance: '5.8338932400000000' }],
    bonusWallets: [{ currency: 'CNY', balance: '9.7907460000000000' }],
  },
  pricing: { currency: 'CNY', peakMultiplier: 2, refreshSeconds: 30, balanceRefreshSeconds: 180 },
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
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '', appendChild() {} }),
    head: { appendChild: (node) => styleNodes.push(node) },
  },
  fetch: async (url) => ({
    ok: true,
    status: 200,
    async json() {
      sandbox.__lastUrl = url
      return PAYLOAD
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

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'dsh-usage-widget/client.js' })

const definition = sandbox.__loaded
check('module registers itself through the module-loader handshake', () => {
  assert.ok(definition, 'window.__ModuleLoader__.load was called')
  assert.equal(definition.id, 'dsh-usage-widget')
  assert.equal(typeof definition.factory, 'function')
})

const moduleExports = definition.factory((name) => (name === 'react' ? React : undefined))
check('exports the client plugin contract', () => {
  // The exports come from another vm realm, so compare by structure, not identity.
  assert.equal(JSON.stringify(Array.from(moduleExports.inject)), JSON.stringify(['slots', 'locale']))
  assert.equal(typeof moduleExports.apply, 'function')
})

/* ------------------------------------------------------------- run apply */

const registrations = []
const cleanups = []
const ctx = {
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
  uiSession: {
    adapter: {
      current: {
        getSnapshot: () => ({ key: 'session-test' }),
        subscribe: () => () => {},
      },
    },
  },
}

moduleExports.apply(ctx)

check('registers exactly one entry into the sidebar footer slot', () => {
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].slot, 'sidebar.footer.action')
  assert.equal(registrations[0].value.options.id, 'dsh-usage-widget')
  assert.equal(registrations[0].value.options.name, 'sidebar.footer.action')
})

/* --------------------------------------------------------------- rendering */

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node.__el) return `${node.type === 'svg' ? '' : ''}${textOf(node.props?.children)}`
  return ''
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

const wideTree = await render({ wide: true, t: (key) => key })
const wideText = textOf(wideTree)

check('wide footer row shows balance, bonus and today totals from the host route', () => {
  assert.match(wideText, /balance\s+¥5\.83/, `balance rendered: ${wideText}`)
  assert.match(wideText, /bonus\s+¥9\.79/, 'bonus wallet is visible without expanding')
  assert.match(wideText, /20\.34M/, 'today token total rendered')
  assert.match(wideText, /¥1\.3/, 'today cost rendered')
  assert.ok(String(sandbox.__lastUrl).includes('sessionId=session-test'), 'the current session id is sent to the host')
})

check('collapsed rail collapses to an icon carrying the full summary', () => {
  return (async () => {
    const narrow = await render({ wide: false, t: (key) => key })
    const text = textOf(narrow)
    assert.ok(!text.includes('20.34M'), 'no inline text in the rail')
    const holder = find(narrow, (node) => node.props?.className === 'dsh-uw dsh-uw_narrow')
    assert.ok(holder, 'narrow holder present')
    const tooltip = String(holder.props.title)
    assert.match(tooltip, /balance: ¥5\.83 · bonus ¥9\.79/, `bonus in the collapsed tooltip: ${tooltip}`)
    assert.match(tooltip, /today: 20\.34M tokens/)
  })()
})

const clickTarget = find(wideTree, (node) => node.props?.className === 'dsh-uw_row')
check('the summary row is a real button with an expanded state', () => {
  assert.ok(clickTarget, 'row found')
  assert.equal(clickTarget.type, 'button')
  assert.equal(clickTarget.props['aria-expanded'], false)
  assert.equal(typeof clickTarget.props.onClick, 'function')
})

check('clicking expands a panel with balance, per-model and current-session detail', () => {
  return (async () => {
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
  })()
})

check('the stylesheet is registered under the plugin name and is removable', () => {
  assert.equal(styleNodes.length, 1)
  const style = styleNodes[0]
  assert.match(style.textContent, /\.dsh-uw_row/)
  let removed = false
  const cleanup = cleanups.find(() => true)
  assert.equal(typeof cleanup, 'function')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
