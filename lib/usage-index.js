/**
 * Incremental aggregation of token usage from DSH session logs.
 *
 * Every billed attempt is recorded by the agent loop as an `assistant/message`
 * carrying `data.usage`; that event is the only source of truth here. Each
 * session artifact is read once and then only its newly appended Zstandard
 * frames are decoded, so a refresh during an active turn costs the size of the
 * last batch rather than the size of the whole log.
 *
 * Buckets are keyed by **local** calendar day so "today" follows the user's
 * clock, while the peak/off-peak split stored per model uses the record's own
 * timestamp, which keeps pricing correct after a refresh or a long session.
 *
 * @module dsh-usage-widget/usage-index
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { decodeCompleteFrames, parseJsonl } from './session-log.js'
import { isPeak } from './pricing.js'

/** Sessions live under the DSH home unless the deployment moved them. */
export function resolveSessionsDir(configured) {
  if (typeof configured === 'string' && configured.length > 0) return configured
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.length > 0) return path.join(home, 'sessions')
  return path.join(os.homedir(), '.dsh', 'sessions')
}

const pad2 = (value) => (value < 10 ? `0${value}` : String(value))

/**
 * Bytes of the consumed prefix kept for rewrite detection. Compressed frames
 * make a coincidental match at this width effectively impossible, and the
 * probe is a single small read.
 */
const SENTINEL_BYTES = 32

/**
 * Local calendar day of a moment, as `YYYY-MM-DD`.
 * @param timeMs - epoch milliseconds.
 * @returns the local day key.
 */
export function localDayKey(timeMs) {
  const date = new Date(timeMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Local calendar month of a moment, as `YYYY-MM`, which is also the prefix of
 * every day key in that month.
 * @param timeMs - epoch milliseconds.
 * @returns the local month key.
 */
export function localMonthKey(timeMs) {
  const date = new Date(timeMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

/** One day of usage for one session. */
function emptyBucket() {
  return {
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    firstMs: 0,
    lastMs: 0,
    models: Object.create(null),
  }
}

function emptyModelRecord() {
  return {
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    peak: { input: 0, cacheRead: 0, output: 0 },
    offPeak: { input: 0, cacheRead: 0, output: 0 },
  }
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** Add one usage record into a bucket. */
function addUsage(bucket, { timeMs, model, usage }) {
  const input = num(usage.inputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const output = num(usage.outputTokens)
  const reasoning = num(usage.reasoningTokens)
  if (input + cacheRead + output === 0) return false

  bucket.requests += 1
  bucket.inputTokens += input
  bucket.cacheReadTokens += cacheRead
  bucket.outputTokens += output
  bucket.reasoningTokens += reasoning
  if (bucket.firstMs === 0 || timeMs < bucket.firstMs) bucket.firstMs = timeMs
  if (timeMs > bucket.lastMs) bucket.lastMs = timeMs

  const key = typeof model === 'string' && model.length > 0 ? model : '(unknown)'
  const record = bucket.models[key] ?? (bucket.models[key] = emptyModelRecord())
  record.requests += 1
  record.inputTokens += input
  record.cacheReadTokens += cacheRead
  record.outputTokens += output
  record.reasoningTokens += reasoning
  const window = isPeak(timeMs) ? record.peak : record.offPeak
  window.input += input
  window.cacheRead += cacheRead
  window.output += output
  return true
}

/** Merge `source` into `target` (both buckets for the same day). */
function mergeBucket(target, source) {
  target.requests += source.requests
  target.inputTokens += source.inputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.outputTokens += source.outputTokens
  target.reasoningTokens += source.reasoningTokens
  if (source.firstMs !== 0 && (target.firstMs === 0 || source.firstMs < target.firstMs)) target.firstMs = source.firstMs
  if (source.lastMs > target.lastMs) target.lastMs = source.lastMs
  for (const [model, record] of Object.entries(source.models)) {
    const into = target.models[model] ?? (target.models[model] = emptyModelRecord())
    into.requests += record.requests
    into.inputTokens += record.inputTokens
    into.cacheReadTokens += record.cacheReadTokens
    into.outputTokens += record.outputTokens
    into.reasoningTokens += record.reasoningTokens
    for (const window of ['peak', 'offPeak']) {
      into[window].input += record[window].input
      into[window].cacheRead += record[window].cacheRead
      into[window].output += record[window].output
    }
  }
  return target
}

/** Extract the fields this plugin bills on from one persisted event. */
function usageOf(record) {
  if (record === null || typeof record !== 'object') return null
  if (record.type !== 'assistant/message') return null
  const data = record.data ?? {}
  const usage = data.usage
  if (usage === null || typeof usage !== 'object') return null
  const timeMs = num(record.time) || num(data.time)
  if (timeMs === 0) return null
  const source = data.message?.source ?? data.source ?? {}
  const model = typeof source.model === 'string' ? source.model : typeof data.model === 'string' ? data.model : ''
  return { timeMs, model, usage }
}

/**
 * Aggregated, incrementally maintained view over the sessions directory.
 */
export class UsageIndex {
  /** @param options - sessions directory, retention and diagnostics sink. */
  constructor({ sessionsDir, keepDays = 45, logger = null } = {}) {
    this.sessionsDir = resolveSessionsDir(sessionsDir)
    this.keepDays = keepDays
    this.logger = logger
    /** @type {Map<string, {path: string, sessionId: string, consumed: number, size: number, buckets: Map<string, object>}>} */
    this.files = new Map()
    this.revision = 0
    this.mergeCache = new Map()
    this.lastError = null
    this.lastScanMs = 0
    this.scannedFiles = 0
  }

  /** Discover session artifacts, bounded to the three levels DSH uses. */
  async listFiles() {
    const found = []
    const walk = async (dir, depth) => {
      let entries
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (depth < 3) await walk(full, depth + 1)
        } else if (entry.name.endsWith('.jsonl.zstd') || entry.name.endsWith('.jsonl')) {
          found.push(full)
        }
      }
    }
    await walk(this.sessionsDir, 1)
    return found
  }

  /** Read whatever became durable since the last refresh. */
  async refresh() {
    const started = Date.now()
    const paths = await this.listFiles()
    const seen = new Set()
    let changed = false
    // Collected per pass and published at the end: an earlier version only ever
    // assigned `lastError`, so a diagnostic from a transient failure stayed on
    // the wire forever and made a healthy index look broken.
    let scanError = null

    for (const file of paths) {
      seen.add(file)
      let stat
      try {
        stat = await fsp.stat(file)
      } catch {
        continue
      }
      let record = this.files.get(file)
      if (record === undefined) {
        record = {
          path: file,
          sessionId: sessionIdFromPath(file),
          consumed: 0,
          size: 0,
          sentinel: null,
          buckets: new Map(),
        }
        this.files.set(file, record)
      }
      // A rewritten (compacted) artifact restarts from byte zero.
      if (stat.size < record.consumed) {
        record.consumed = 0
        record.sentinel = null
        record.buckets = new Map()
      }
      record.size = stat.size
      if (stat.size === record.consumed) continue

      // Size alone cannot tell an append from a rewrite: a compacted artifact
      // can be longer than what was already consumed, and continuing from the
      // old offset then either fails structurally or — worse — lands on a
      // frame boundary and silently adds the new content to the old. Verify the
      // tail of the consumed prefix instead.
      if (record.consumed > 0) {
        const tailLength = Math.min(SENTINEL_BYTES, record.consumed)
        const probe = Buffer.alloc(tailLength)
        let rewritten = false
        try {
          const handle = await fsp.open(file, 'r')
          try {
            const { bytesRead } = await handle.read(probe, 0, tailLength, record.consumed - tailLength)
            rewritten = bytesRead !== tailLength || record.sentinel === null || !probe.equals(record.sentinel)
          } finally {
            await handle.close()
          }
        } catch (error) {
          scanError = `probe ${path.basename(file)}: ${error?.message ?? error}`
          continue
        }
        if (rewritten) {
          record.consumed = 0
          record.sentinel = null
          record.buckets = new Map()
        }
      }
      if (stat.size === record.consumed) continue

      let slice
      try {
        const handle = await fsp.open(file, 'r')
        try {
          const length = stat.size - record.consumed
          const buffer = Buffer.alloc(length)
          // A session artifact can be rewritten between stat() and read(). This
          // used to trust the stat size, so a file that had shrunk came back
          // zero-padded and the frame scanner rejected the padding as
          // corruption — a spurious error that also wiped the file's buckets.
          const { bytesRead } = await handle.read(buffer, 0, length, record.consumed)
          slice = bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
        } finally {
          await handle.close()
        }
      } catch (error) {
        scanError = `read ${path.basename(file)}: ${error?.message ?? error}`
        continue
      }
      if (slice.length === 0) continue

      let decoded
      try {
        decoded = decodeCompleteFrames(slice)
      } catch (error) {
        // Structurally corrupt tail: restart this artifact so a later append
        // cannot be read from a bogus offset.
        scanError = `decode ${path.basename(file)}: ${error?.message ?? error}`
        record.consumed = 0
        record.buckets = new Map()
        continue
      }
      if (decoded.consumed === 0) continue

      record.consumed += decoded.consumed
      // Keep the tail of the consumed prefix so the next pass can tell an
      // append from a rewrite.
      const consumedNow = slice.subarray(0, decoded.consumed)
      const combined = record.sentinel === null ? consumedNow : Buffer.concat([record.sentinel, consumedNow])
      record.sentinel = Buffer.from(combined.subarray(Math.max(0, combined.length - SENTINEL_BYTES)))
      const records = parseJsonl(decoded.text)
      for (const parsed of records) {
        if (parsed?.type === 'session' && typeof parsed.id === 'string') {
          record.sessionId = parsed.id
          continue
        }
        const found = usageOf(parsed)
        if (found === null) continue
        const dayKey = localDayKey(found.timeMs)
        let bucket = record.buckets.get(dayKey)
        if (bucket === undefined) {
          bucket = emptyBucket()
          record.buckets.set(dayKey, bucket)
        }
        if (addUsage(bucket, found)) changed = true
      }
      if (records.length > 0) changed = true
      this.prune(record)
    }

    for (const file of [...this.files.keys()]) {
      if (!seen.has(file)) this.files.delete(file)
    }

    if (changed) {
      this.revision += 1
      this.mergeCache.clear()
    }
    this.lastError = scanError
    this.lastScanMs = Date.now() - started
    this.scannedFiles = this.files.size
    return changed
  }

  /** Drop day buckets past the retention horizon. */
  prune(record) {
    if (record.buckets.size === 0) return
    const cutoff = localDayKey(Date.now() - this.keepDays * 24 * 60 * 60 * 1000)
    for (const key of [...record.buckets.keys()]) {
      if (key < cutoff) record.buckets.delete(key)
    }
  }

  /** All session ids currently indexed. */
  sessionIds() {
    return [...this.files.values()].map((record) => record.sessionId)
  }

  /**
   * Usage for one local day, optionally for a single session.
   * @param dayKey - local day key.
   * @param sessionId - restrict to one session when given.
   * @returns a detached bucket plus the number of contributing sessions.
   */
  bucketFor(dayKey, sessionId) {
    const cacheKey = `${this.revision}|${dayKey}|${sessionId ?? '*'}`
    const cached = this.mergeCache.get(cacheKey)
    if (cached !== undefined) return cached

    const merged = emptyBucket()
    let sessions = 0
    for (const record of this.files.values()) {
      if (sessionId !== undefined && record.sessionId !== sessionId) continue
      const bucket = record.buckets.get(dayKey)
      if (bucket === undefined) continue
      sessions += 1
      mergeBucket(merged, bucket)
    }
    const result = { bucket: merged, sessions }
    this.mergeCache.set(cacheKey, result)
    return result
  }

  /**
   * Usage for one local month, optionally for a single session.
   *
   * Buckets are keyed by day, so a month is the union of the day buckets whose
   * key starts with `YYYY-MM`. The result also reports whether the retention
   * window still reaches back to the first of the month: `keepDays` below 32
   * can leave an early-month total short, and the caller says so rather than
   * presenting a partial figure as a complete one.
   *
   * @param monthKey - local month key, `YYYY-MM`.
   * @param sessionId - restrict to one session when given.
   * @returns the merged bucket, contributing sessions, active days and whether
   *   the whole month is within the retention window.
   */
  monthFor(monthKey, sessionId) {
    const cacheKey = `${this.revision}|M:${monthKey}|${sessionId ?? '*'}`
    const cached = this.mergeCache.get(cacheKey)
    if (cached !== undefined) return cached

    const merged = emptyBucket()
    const days = new Set()
    let sessions = 0
    for (const record of this.files.values()) {
      if (sessionId !== undefined && record.sessionId !== sessionId) continue
      let contributed = false
      for (const [dayKey, bucket] of record.buckets) {
        if (dayKey.slice(0, 7) !== monthKey) continue
        mergeBucket(merged, bucket)
        days.add(dayKey)
        contributed = true
      }
      if (contributed) sessions += 1
    }

    const cutoff = localDayKey(Date.now() - this.keepDays * 24 * 60 * 60 * 1000)
    const result = { bucket: merged, sessions, days: days.size, complete: cutoff <= `${monthKey}-01` }
    this.mergeCache.set(cacheKey, result)
    return result
  }

  /** Filesystem-level diagnostics for the widget's error row. */
  stats() {    return {
      sessionsDir: this.sessionsDir,
      files: this.files.size,
      lastScanMs: this.lastScanMs,
      lastError: this.lastError,
      exists: fs.existsSync(this.sessionsDir),
    }
  }
}

/** Session identity fallback from the artifact path. */
function sessionIdFromPath(file) {
  const dir = path.basename(path.dirname(file))
  if (dir.startsWith('session-')) return dir
  const base = path.basename(file)
  const cut = base.indexOf('.jsonl')
  return cut > 0 ? base.slice(0, cut) : base
}
