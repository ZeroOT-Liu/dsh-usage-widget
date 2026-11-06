/**
 * Multi-frame Zstandard reader for DSH session logs.
 *
 * A `.jsonl.zstd` session artifact is a concatenation of independently
 * decodable, checksummed Zstandard frames — one per durable header/batch
 * append. Node's one-shot `zstdDecompressSync` stops after the first frame,
 * so the frame boundaries are located structurally first and each frame is
 * decoded on its own.
 *
 * `scanZstdFrames` mirrors the scanner DSH itself uses
 * (`dsh-session-persistence-jsonl`, `scanZstdFrames`). A frame whose bytes are
 * not all present yet is reported as `torn` and deliberately never decoded:
 * leaving it unconsumed means the next refresh re-reads it once it is whole,
 * so a partially flushed batch can never be counted twice.
 *
 * @module dsh-usage-widget/session-log
 */
import zlib from 'node:zlib'

/** Zstandard frame magic, little-endian at a frame start. */
const ZSTD_MAGIC = 4247762216

/**
 * Locate structurally complete Zstandard frames without decoding their blocks.
 * @param buffer - bytes currently present in the session artifact.
 * @param maxFrames - optional complete-frame limit.
 * @returns complete frame ranges and the start of an incomplete final frame.
 * @throws when a complete frame's structure is corrupt.
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/**
 * Decode every complete frame in a byte range.
 * @param slice - bytes starting exactly at a frame boundary.
 * @returns decoded text plus how many bytes became safe to consume, and
 *   whether an incomplete trailing frame was left behind.
 */
export function decodeCompleteFrames(slice) {
  if (slice.length === 0) return { text: '', consumed: 0, torn: false }
  const { frames, tornStart } = scanZstdFrames(slice)
  const parts = []
  for (const { start, end } of frames) {
    parts.push(zlib.zstdDecompressSync(slice.subarray(start, end)))
  }
  const consumed = frames.length > 0 ? frames[frames.length - 1].end : 0
  return {
    text: Buffer.concat(parts).toString('utf8'),
    consumed,
    torn: tornStart !== undefined,
  }
}

/**
 * Decode the complete lines of an uncompressed JSONL artifact.
 *
 * DSH normally persists `.jsonl.zstd`, but the directory listing also accepts a
 * plain `.jsonl` file, and that file used to be handed to the Zstandard scanner
 * — which threw on every refresh and pinned the artifact at offset zero forever.
 * The container is chosen from the artifact name rather than sniffed from the
 * bytes, because arbitrary non-Zstandard bytes are corruption, not a plain log,
 * and must keep surfacing as an error.
 *
 * Only whole lines are consumed: a partially flushed trailing line is left for
 * the next refresh, exactly like a torn Zstandard frame, so a half-written
 * record can never be parsed or counted twice.
 *
 * @param slice - bytes starting exactly at a line boundary.
 * @returns decoded text plus how many bytes are safe to consume.
 */
export function decodeTextChunk(slice) {
  if (slice.length === 0) return { text: '', consumed: 0, torn: false }
  const lastBreak = slice.lastIndexOf(0x0a)
  // No newline yet: the whole chunk is an unfinished line.
  if (lastBreak < 0) return { text: '', consumed: 0, torn: true }
  const consumed = lastBreak + 1
  return {
    text: slice.subarray(0, consumed).toString('utf8'),
    consumed,
    torn: consumed < slice.length,
  }
}

/**
 * Split decoded JSONL text into parsed records, skipping blank and malformed
 * lines instead of failing the whole file.
 * @param text - decoded JSONL text.
 * @returns parsed records in file order.
 */
export function parseJsonl(text) {
  const records = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    const trimmed = line.charCodeAt(line.length - 1) === 13 ? line.slice(0, -1) : line
    if (trimmed.length === 0) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // A torn tail can hand us a half-written line; drop it.
    }
  }
  return records
}
