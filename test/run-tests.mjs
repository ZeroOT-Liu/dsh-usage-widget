/**
 * Verification for the usage widget's pure logic and its log reader.
 *
 * Run: node test/run-tests.mjs
 *
 * The aggregation test does not trust the index: it brute-force decodes every
 * session artifact in full and compares the totals with what the incremental
 * index reports, so an incremental-read bug cannot pass unnoticed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { decodeCompleteFrames, parseJsonl, scanZstdFrames } from '../lib/session-log.js'
import { isPeak, modelCost, resolveModelKey, DEFAULT_ALIASES, DEFAULT_PRICES } from '../lib/pricing.js'
import { UsageIndex, localDayKey, localMonthKey, resolveSessionsDir } from '../lib/usage-index.js'
import { bucketView } from '../lib/service.js'
import { normalizeConfig } from '../lib/config.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`)
  }
}

const frame = (text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'))

/* ------------------------------------------------------------ session-log */

console.log('\nsession-log')

const messages = [
  '{"type":"session","id":"session-t","version":4}',
  '{"type":"assistant/message","time":1000,"data":{"usage":{"inputTokens":10,"outputTokens":2},"message":{"source":{"model":"m"}}}}',
  '{"type":"assistant/message","time":2000,"data":{"usage":{"inputTokens":20,"outputTokens":4},"message":{"source":{"model":"m"}}}}',
]
const multipart = Buffer.concat(messages.map((line) => frame(`${line}\n`)))

test('every concatenated frame is located', () => {
  assert.equal(scanZstdFrames(multipart).frames.length, 3)
  assert.equal(scanZstdFrames(multipart).tornStart, undefined)
})

test('all frames decode, not just the first', () => {
  const { text, consumed, torn } = decodeCompleteFrames(multipart)
  assert.equal(torn, false)
  assert.equal(consumed, multipart.length)
  assert.equal(parseJsonl(text).length, 3)
})

test('a partially written frame stays unconsumed', () => {
  const torn = multipart.subarray(0, multipart.length - 5)
  const { text, consumed, torn: isTorn } = decodeCompleteFrames(torn)
  assert.equal(isTorn, true)
  assert.equal(consumed, multipart.length - frame(`${messages[2]}\n`).length)
  assert.equal(parseJsonl(text).length, 2, 'only the two complete frames are read')
})

test('parseJsonl drops an unparseable tail line', () => {
  assert.equal(parseJsonl('{"a":1}\n{"a":\n').length, 1)
})

/* ---------------------------------------------------------------- pricing */

console.log('\npricing')

const beijing = (iso) => Date.parse(iso)

test('weekday business hours are peak (Beijing time)', () => {
  assert.equal(isPeak(beijing('2026-10-16T02:00:00Z')), true, 'Fri 10:00 +08:00')
  assert.equal(isPeak(beijing('2026-10-16T06:00:00Z')), true, 'Fri 14:00 +08:00')
})

test('lunch break, evenings and weekends are off-peak', () => {
  assert.equal(isPeak(beijing('2026-10-16T04:00:00Z')), false, 'Fri 12:00 +08:00')
  assert.equal(isPeak(beijing('2026-10-16T11:00:00Z')), false, 'Fri 19:00 +08:00')
  assert.equal(isPeak(beijing('2026-10-17T02:00:00Z')), false, 'Sat 10:00 +08:00')
  assert.equal(isPeak(beijing('2026-10-16T00:30:00Z')), false, 'Fri 08:30 +08:00')
})

test('legacy model ids resolve to a priced key', () => {
  assert.equal(resolveModelKey('deepseek-v4-flash-vision-exp', DEFAULT_PRICES, DEFAULT_ALIASES), 'deepseek-flash')
  assert.equal(resolveModelKey('deepseek-v4-pro', DEFAULT_PRICES, DEFAULT_ALIASES), 'deepseek-v4-pro')
  assert.equal(resolveModelKey('deepseek-flash', DEFAULT_PRICES, DEFAULT_ALIASES), 'deepseek-flash')
  assert.equal(resolveModelKey('some-other-model', DEFAULT_PRICES, DEFAULT_ALIASES), null)
})

test('cost follows the published table, peak at twice off-peak', () => {
  const price = DEFAULT_PRICES['deepseek-flash']
  const oneMillionOffPeak = { peak: { input: 0, cacheRead: 0, output: 0 }, offPeak: { input: 1e6, cacheRead: 0, output: 0 } }
  assert.equal(modelCost(oneMillionOffPeak, price, 2), 1)
  const oneMillionPeak = { peak: { input: 1e6, cacheRead: 0, output: 0 }, offPeak: { input: 0, cacheRead: 0, output: 0 } }
  assert.equal(modelCost(oneMillionPeak, price, 2), 2)
  const cached = { peak: { input: 0, cacheRead: 0, output: 0 }, offPeak: { input: 0, cacheRead: 1e6, output: 0 } }
  assert.equal(modelCost(cached, price, 2), 0.02)
  const output = { peak: { input: 0, cacheRead: 0, output: 0 }, offPeak: { input: 0, cacheRead: 0, output: 1e6 } }
  assert.equal(modelCost(output, price, 2), 4)
})

test('config normalization falls back to defaults and clamps', () => {
  const settings = normalizeConfig({ refreshSeconds: 1, peakMultiplier: 99, models: { bad: { cacheMiss: 0 } } })
  assert.equal(settings.refreshSeconds, 5)
  assert.equal(settings.peakMultiplier, 10)
  assert.equal(settings.currency, 'CNY')
  assert.deepEqual(settings.models, DEFAULT_PRICES, 'an all-invalid price table keeps the defaults')
})

/* ----------------------------------------------------- incremental index */

console.log('\nincremental index')

async function syntheticTest() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-uw-'))
  const dir = path.join(root, '--fake--', 'session-syn-1')
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')

  const now = Date.now()
  const first = Buffer.concat([
    frame('{"type":"session","id":"session-syn-1","version":4}\n'),
    frame(
      `{"type":"assistant/message","time":${now - 60000},"data":{"usage":{"inputTokens":1000,"cacheReadTokens":500,"outputTokens":100,"reasoningTokens":10},"message":{"source":{"model":"deepseek-v4-pro"}}}}\n`,
    ),
  ])
  await fsp.writeFile(file, first)

  const index = new UsageIndex({ sessionsDir: root })
  await index.refresh()
  const dayKey = localDayKey(now)
  const firstPass = index.bucketFor(dayKey)
  assert.equal(firstPass.bucket.inputTokens, 1000)
  assert.equal(firstPass.bucket.cacheReadTokens, 500)
  assert.equal(firstPass.bucket.outputTokens, 100)
  assert.equal(firstPass.bucket.requests, 1)
  assert.equal(firstPass.sessions, 1)
  assert.equal(index.sessionIds()[0], 'session-syn-1', 'session id comes from the header record')

  // A second refresh with no new bytes must not change anything.
  await index.refresh()
  assert.equal(index.bucketFor(dayKey).bucket.inputTokens, 1000)

  // Append one more frame: it is counted exactly once, across two refreshes.
  const second = frame(
    `{"type":"assistant/message","time":${now - 30000},"data":{"usage":{"inputTokens":200,"cacheReadTokens":0,"outputTokens":30},"message":{"source":{"model":"deepseek-flash"}}}}\n`,
  )
  await fsp.appendFile(file, second)
  await index.refresh()
  const secondPass = index.bucketFor(dayKey)
  assert.equal(secondPass.bucket.inputTokens, 1200)
  assert.equal(secondPass.bucket.requests, 2, 'appended frame counted exactly once')

  // Appending a half-written frame must not be counted before it is complete.
  const third = frame(
    `{"type":"assistant/message","time":${now - 10000},"data":{"usage":{"inputTokens":7,"outputTokens":1},"message":{"source":{"model":"deepseek-flash"}}}}\n`,
  )
  await fsp.appendFile(file, third.subarray(0, third.length - 6))
  await index.refresh()
  assert.equal(index.bucketFor(dayKey).bucket.requests, 2, 'torn frame ignored')

  await fsp.appendFile(file, third.subarray(third.length - 6))
  await index.refresh()
  assert.equal(index.bucketFor(dayKey).bucket.requests, 3, 'torn frame counted once it completes')
  assert.equal(index.bucketFor(dayKey).bucket.inputTokens, 1207)

  const sessionView = index.bucketFor(dayKey, 'session-syn-1')
  assert.equal(sessionView.sessions, 1)

  // A different session id must not see this session's usage.
  assert.equal(index.bucketFor(dayKey, 'session-other').sessions, 0)

  await assertBucketView(index, dayKey)
  await fsp.rm(root, { recursive: true, force: true })
}

/** The wire projection must split costs per model and flag unpriced models. */
async function assertBucketView(index, dayKey) {
  const settings = normalizeConfig({})
  const view = bucketView(index.bucketFor(dayKey).bucket, settings)
  assert.equal(view.totalTokens, 1207 + 500 + 131)
  assert.equal(view.costComplete, true)
  assert.equal(view.models.length, 2)
  const pro = view.models.find((entry) => entry.model === 'deepseek-v4-pro')
  const flash = view.models.find((entry) => entry.model === 'deepseek-flash')
  assert.ok(pro.priced && flash.priced)
  assert.ok(view.cost > 0)

  const unpriced = bucketView(
    { ...index.bucketFor(dayKey).bucket, models: { 'mystery-model': pro ? { ...pro, model: 'mystery-model' } : {} } },
    settings,
  )
  assert.equal(unpriced.costComplete, false)
  assert.deepEqual(unpriced.unpricedModels, ['mystery-model'])
}

/* ------------------------------------------------------ month aggregation */

console.log('\nmonth aggregation')

/**
 * Month-to-date sums the day buckets of one month, so the test fixes the
 * calendar itself rather than trusting the machine's date: two sessions,
 * records spread over two distinct days of the current month, plus a record in
 * the previous month that must not leak in.
 */
async function monthAggregationTest() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-uw-month-'))
  const now = new Date()
  const dayIn = (monthOffset, day) => new Date(now.getFullYear(), now.getMonth() + monthOffset, day, 12, 0, 0).getTime()

  const writeSession = async (dirName, sessionId, entries) => {
    const dir = path.join(root, '--fake--', dirName)
    await fsp.mkdir(dir, { recursive: true })
    const frames = [frame(`${JSON.stringify({ type: 'session', id: sessionId, version: 4 })}\n`)]
    for (const entry of entries) {
      const record = {
        type: 'assistant/message',
        time: entry.time,
        data: {
          usage: {
            inputTokens: entry.input,
            cacheReadTokens: entry.cacheRead ?? 0,
            outputTokens: entry.output,
          },
          message: { source: { model: 'deepseek-v4-pro' } },
        },
      }
      frames.push(frame(`${JSON.stringify(record)}\n`))
    }
    await fsp.writeFile(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(frames))
  }

  await writeSession('session-A', 'session-A', [
    { time: dayIn(0, 3), input: 100, cacheRead: 50, output: 10 },
    { time: dayIn(0, 3), input: 200, cacheRead: 0, output: 20 },
    { time: dayIn(0, 9), input: 400, cacheRead: 0, output: 40 },
    { time: dayIn(-1, 5), input: 1000, cacheRead: 0, output: 100 },
  ])
  await writeSession('session-B', 'session-B', [
    { time: dayIn(0, 9), input: 800, cacheRead: 0, output: 80 },
    { time: dayIn(-1, 5), input: 2000, cacheRead: 0, output: 200 },
  ])

  const index = new UsageIndex({ sessionsDir: root, keepDays: 400 })
  await index.refresh()

  const currentMonth = localMonthKey(Date.now())
  const previousMonth = localMonthKey(dayIn(-1, 5))

  test('localMonthKey is the prefix of localDayKey', () => {
    const stamp = dayIn(0, 9)
    assert.equal(localDayKey(stamp).slice(0, 7), localMonthKey(stamp))
    assert.notEqual(currentMonth, previousMonth)
  })

  const month = index.monthFor(currentMonth)
  test('the current month sums every session and counts distinct active days', () => {
    assert.equal(month.bucket.inputTokens, 100 + 200 + 400 + 800)
    assert.equal(month.bucket.cacheReadTokens, 50)
    assert.equal(month.bucket.outputTokens, 10 + 20 + 40 + 80)
    assert.equal(month.bucket.requests, 4)
    assert.equal(month.sessions, 2, 'both sessions contributed')
    assert.equal(month.days, 2, 'two distinct days had usage')
    assert.equal(month.complete, true, 'retention reaches back past the month start')
  })

  test('the previous month is excluded from the current month', () => {
    const previous = index.monthFor(previousMonth)
    assert.equal(previous.bucket.inputTokens, 1000 + 2000)
    assert.equal(previous.bucket.requests, 2)
    assert.equal(previous.days, 1)
  })

  test('a month can be scoped to one session', () => {
    const scoped = index.monthFor(currentMonth, 'session-A')
    assert.equal(scoped.bucket.inputTokens, 700)
    assert.equal(scoped.bucket.requests, 3)
    assert.equal(scoped.sessions, 1)
    assert.equal(scoped.days, 2)
    assert.equal(index.monthFor(currentMonth, 'session-other').bucket.requests, 0)
  })

  test('the wire view prices a month like a day', () => {
    const settings = normalizeConfig({})
    const view = bucketView(index.monthFor(currentMonth).bucket, settings)
    assert.equal(view.totalTokens, 1500 + 50 + 150)
    assert.equal(view.costComplete, true)
    assert.ok(view.cost > 0)
  })

  test('a retention window that cannot reach the month start is reported', () => {
    const narrow = new UsageIndex({ sessionsDir: root, keepDays: 2 })
    // buckets are pruned on refresh, so assert the flag without refreshing
    narrow.files = index.files
    narrow.revision = index.revision
    assert.equal(narrow.monthFor(currentMonth).complete, false, 'two days cannot cover a month')
  })

  await fsp.rm(root, { recursive: true, force: true })
}

/* ------------------------------------------------ artifact rewrite recovery */

console.log('\nartifact rewrite recovery')

/**
 * Session artifacts get rewritten (compacted) under the reader. Two defects
 * showed up in the field because of that: a diagnostic from a transient
 * failure was never cleared, and trusting `stat().size` over the bytes actually
 * read turned a shrunk file into zero padding that the scanner rejected.
 */
async function rewriteRecoveryTest() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-uw-rewrite-'))
  const dir = path.join(root, '--fake--', 'session-R')
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')

  const artifact = (inputs) =>
    Buffer.concat([
      frame(`${JSON.stringify({ type: 'session', id: 'session-R', version: 4 })}\n`),
      ...inputs.map((input) =>
        frame(
          `${JSON.stringify({
            type: 'assistant/message',
            time: Date.now() - 1000,
            data: {
              usage: { inputTokens: input, cacheReadTokens: 0, outputTokens: 1 },
              message: { source: { model: 'deepseek-v4-pro' } },
            },
          })}\n`,
        ),
      ),
    ])

  const index = new UsageIndex({ sessionsDir: root })
  const dayKey = localDayKey(Date.now())

  await fsp.writeFile(file, artifact([100, 200]))
  await index.refresh()
  test('a healthy pass reports no error', () => {
    assert.equal(index.stats().lastError, null)
    assert.equal(index.bucketFor(dayKey).bucket.inputTokens, 300)
  })

  // Simulate a truncated/rewritten artifact the reader cannot parse.
  await fsp.writeFile(file, Buffer.from('this is not a zstandard frame at all'))
  await index.refresh()
  test('an unreadable artifact is reported', () => {
    assert.ok(index.stats().lastError !== null, 'the failure is surfaced')
  })

  await fsp.writeFile(file, artifact([500]))
  await index.refresh()
  test('a clean pass clears the previous diagnostic instead of keeping it forever', () => {
    assert.equal(index.stats().lastError, null, 'a stale error must not persist')
    assert.equal(index.bucketFor(dayKey).bucket.inputTokens, 500, 'the rewritten artifact is re-read')
  })

  await fsp.writeFile(file, artifact([7, 7, 7]))
  await index.refresh()
  test('a rewritten artifact replaces its earlier totals rather than adding to them', () => {
    assert.equal(index.bucketFor(dayKey).bucket.inputTokens, 21)
  })

  await fsp.rm(root, { recursive: true, force: true })
}

/* ------------------------------------------------- real session artifacts */

console.log('\nreal session artifacts')

async function realLogTest() {
  const sessionsDir = resolveSessionsDir(null)
  if (!fs.existsSync(sessionsDir)) {
    console.log(`  skip no sessions directory at ${sessionsDir}`)
    return
  }
  const index = new UsageIndex({ sessionsDir })
  await index.refresh()
  const stats = index.stats()
  if (stats.files === 0) {
    console.log(`  skip no session artifacts in ${sessionsDir}`)
    return
  }

  // Independent brute-force pass: decode every artifact in full.
  const files = await index.listFiles()
  const dayKey = localDayKey(Date.now())
  const monthKey = localMonthKey(Date.now())
  const brute = { requests: 0, input: 0, cacheRead: 0, output: 0 }
  const monthBrute = { requests: 0, input: 0, cacheRead: 0, output: 0, days: new Set() }
  for (const file of files) {
    const buffer = await fsp.readFile(file)
    const { frames } = scanZstdFrames(buffer)
    const text = Buffer.concat(frames.map(({ start, end }) => zlib.zstdDecompressSync(buffer.subarray(start, end)))).toString('utf8')
    for (const record of parseJsonl(text)) {
      if (record?.type !== 'assistant/message') continue
      const usage = record.data?.usage
      const timeMs = Number(record.time) || Number(record.data?.time)
      if (usage === null || typeof usage !== 'object') continue
      if (!Number.isFinite(timeMs)) continue
      if (localDayKey(timeMs) !== dayKey && localMonthKey(timeMs) !== monthKey) continue
      const input = Number(usage.inputTokens) || 0
      const cacheRead = Number(usage.cacheReadTokens) || 0
      const output = Number(usage.outputTokens) || 0
      if (localMonthKey(timeMs) === monthKey) {
        monthBrute.requests += 1
        monthBrute.input += input
        monthBrute.cacheRead += cacheRead
        monthBrute.output += output
        monthBrute.days.add(localDayKey(timeMs))
      }
      if (localDayKey(timeMs) !== dayKey) continue
      brute.requests += 1
      brute.input += input
      brute.cacheRead += cacheRead
      brute.output += output
    }
  }

  const indexed = index.bucketFor(dayKey).bucket
  assert.equal(indexed.requests, brute.requests, 'request count matches a full decode')
  assert.equal(indexed.inputTokens, brute.input, 'uncached input matches')
  assert.equal(indexed.cacheReadTokens, brute.cacheRead, 'cache-read input matches')
  assert.equal(indexed.outputTokens, brute.output, 'output matches')

  const indexedMonth = index.monthFor(monthKey)
  assert.equal(indexedMonth.bucket.requests, monthBrute.requests, 'month request count matches a full decode')
  assert.equal(indexedMonth.bucket.inputTokens, monthBrute.input, 'month uncached input matches')
  assert.equal(indexedMonth.bucket.cacheReadTokens, monthBrute.cacheRead, 'month cache-read input matches')
  assert.equal(indexedMonth.bucket.outputTokens, monthBrute.output, 'month output matches')
  assert.equal(indexedMonth.days, monthBrute.days.size, 'month active-day count matches')
  assert.ok(
    indexedMonth.bucket.requests >= indexed.requests,
    'the month can never hold fewer requests than the day inside it',
  )

  const view = bucketView(indexed, normalizeConfig({}))
  const monthView = bucketView(indexedMonth.bucket, normalizeConfig({}))
  console.log(
    `  info files=${stats.files} sessions=${index.sessionIds().length} today requests=${view.requests} tokens=${view.totalTokens} cost=${view.cost} ${view.costComplete ? '' : `(unpriced: ${view.unpricedModels.join(',')})`}`,
  )
  console.log(
    `  info month=${monthKey} days=${indexedMonth.days} requests=${monthView.requests} tokens=${monthView.totalTokens} cost=${monthView.cost} complete=${indexedMonth.complete}`,
  )
  assert.ok(view.totalTokens === view.inputTokens + view.cacheReadTokens + view.outputTokens)
}

await testAsync('synthetic multi-frame append, torn frame and per-model cost', syntheticTest)
await testAsync('month aggregation across days, months and sessions', monthAggregationTest)
await testAsync('artifact rewrite recovery and diagnostics', rewriteRecoveryTest)
await testAsync('indexed usage equals a full brute-force decode of the real logs', realLogTest)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
