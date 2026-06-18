/**
 * Pure, dependency-free MPEG-1 Audio Layer III frame analyzer.
 * No Worker/DOM deps — unit-testable and embeddable as a library.
 * See PRD.md and docs/adr/0001 (frameCount excludes the Xing/Info/VBRI header frame).
 */

// MPEG-1 Layer III lookup tables (index = header bits). ChannelMode is derived from
// CHANNEL_MODES below, so the public type can never drift from the runtime table.
const BITRATE_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1] as const;
const SAMPLE_RATE = [44100, 48000, 32000, -1] as const;
const CHANNEL_MODES = ["stereo", "joint_stereo", "dual_channel", "mono"] as const;
const SAMPLES_PER_FRAME = 1152;
const MAX_FRAME_LENGTH = 1441; // 144 * 320000 / 32000 + 1 — largest MPEG-1 L3 frame
const RESYNC_BOUND = 128 * 1024; // cap the forward scan — bounds worst-case CPU on garbage

export type ChannelMode = (typeof CHANNEL_MODES)[number];

export type Bitrate =
  | { readonly mode: "cbr"; readonly kbps: number }
  | { readonly mode: "vbr"; readonly averageKbps: number; readonly nominalKbps?: number };

export type HeaderKind = "xing" | "info" | "vbri" | "none";

export type FrameAnalysis = {
  readonly frameCount: number;
  readonly framesIncludingHeader: number;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channelMode: ChannelMode;
  readonly bitrate: Bitrate;
  readonly header: { readonly kind: HeaderKind; readonly declaredFrameCount?: number };
  readonly flags: { readonly truncated: boolean; readonly corrupt: boolean };
};

export type AnalyzeErrorCode = "empty" | "not-mpeg1-layer3" | "free-format";

export type AnalyzeError = { readonly code: AnalyzeErrorCode; readonly message: string };

export type AnalyzeResult =
  | { readonly ok: true; readonly analysis: FrameAnalysis }
  | { readonly ok: false; readonly error: AnalyzeError };

type Header = { bitrateKbps: number; sampleRate: number; channelMode: ChannelMode; frameLength: number };

/** Byte offset of the first audio frame past an ID3v2 tag, or 0 if none. */
function id3v2End(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  // Size is a 28-bit syncsafe integer (7 bits per byte) and excludes the 10-byte header.
  const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  return 10 + size;
}

/** Parse a 4-byte MPEG-1 Layer III header at `i`, or null if not a valid in-scope header. */
function parseHeader(b: Uint8Array, i: number): Header | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return null; // 11-bit sync
  if (((b[i + 1]! >> 3) & 0x3) !== 0x3) return null; // version must be MPEG-1 (11)
  if (((b[i + 1]! >> 1) & 0x3) !== 0x1) return null; // layer must be III (01)
  const bitrateKbps = BITRATE_KBPS[(b[i + 2]! >> 4) & 0xf]!;
  const sampleRate = SAMPLE_RATE[(b[i + 2]! >> 2) & 0x3]!;
  if (bitrateKbps <= 0 || sampleRate <= 0) return null; // free-format / invalid handled elsewhere
  const padding = (b[i + 2]! >> 1) & 0x1;
  const channelMode = CHANNEL_MODES[(b[i + 3]! >> 6) & 0x3]!;
  const frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  return { bitrateKbps, sampleRate, channelMode, frameLength };
}

/** Parse a Xing/Info/VBRI metadata block in the first frame, if present. */
function parseHeaderTag(
  b: Uint8Array,
  frameStart: number,
  frameLength: number,
): { kind: HeaderKind; declaredFrameCount?: number } {
  const end = Math.min(frameStart + frameLength, b.length);
  for (let i = frameStart + 4; i + 4 <= end; i++) {
    const tag = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    if (tag === "Xing" || tag === "Info") {
      const kind: HeaderKind = tag === "Xing" ? "xing" : "info";
      // 4-byte big-endian flags at i+4; bit 0 (LSB at b[i+7]) => frame count present at i+8.
      if (i + 12 <= end && (b[i + 7]! & 0x1) === 0x1) {
        const frames = ((b[i + 8]! << 24) | (b[i + 9]! << 16) | (b[i + 10]! << 8) | b[i + 11]!) >>> 0;
        return { kind, declaredFrameCount: frames };
      }
      return { kind };
    }
    if (tag === "VBRI") return { kind: "vbri" };
  }
  return { kind: "none" };
}

/** End of audio data: trims a trailing 128-byte ID3v1 ("TAG") block if present. */
function audioEnd(b: Uint8Array): number {
  if (
    b.length >= 128 &&
    b[b.length - 128] === 0x54 &&
    b[b.length - 127] === 0x41 &&
    b[b.length - 126] === 0x47 // "TAG"
  ) {
    return b.length - 128;
  }
  return b.length;
}

/** A frame at `i` whose following frame also parses (2-frame confirmation), or null. */
function confirmedFrameAt(b: Uint8Array, i: number, end: number): Header | null {
  const h = parseHeader(b, i);
  if (h === null || i + h.frameLength > end) return null;
  const next = i + h.frameLength;
  if (next + 4 > end) return h; // nothing after to confirm against — accept
  return parseHeader(b, next) !== null ? h : null;
}

/** Bounded forward scan (native indexOf over 0xFF) for the next confirmed frame past garbage. */
function resync(b: Uint8Array, from: number, end: number): number {
  const bound = Math.min(end, from + RESYNC_BOUND);
  let i = from + 1;
  while (i < bound) {
    const idx = b.indexOf(0xff, i);
    if (idx === -1 || idx >= bound) return -1;
    if (confirmedFrameAt(b, idx, end) !== null) return idx;
    i = idx + 1;
  }
  return -1;
}

export function analyzeMp3(bytes: Uint8Array): AnalyzeResult {
  if (bytes.length === 0) {
    return { ok: false, error: { code: "empty", message: "File is empty." } };
  }

  // Skip any ID3v2 tag so the scan never takes a false sync from tag/cover-art bytes.
  let i = id3v2End(bytes);
  let first: Header | null = null;
  for (; i + 4 <= bytes.length; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) continue; // 11-bit sync
    if (((bytes[i + 1]! >> 3) & 0x3) !== 0x3 || ((bytes[i + 1]! >> 1) & 0x3) !== 0x1) continue; // MPEG-1, Layer III
    const bitrateIndex = (bytes[i + 2]! >> 4) & 0xf;
    if (bitrateIndex === 0x0) {
      return { ok: false, error: { code: "free-format", message: "Free-format MP3 is not supported." } };
    }
    if (bitrateIndex === 0xf) continue; // invalid bitrate ("bad") — false sync, keep scanning
    const h = parseHeader(bytes, i);
    if (h !== null) {
      first = h;
      break;
    }
  }
  if (first === null) {
    return { ok: false, error: { code: "not-mpeg1-layer3", message: "No MPEG-1 Layer III frames found." } };
  }

  const tag = parseHeaderTag(bytes, i, first.frameLength);
  const end = audioEnd(bytes);

  // Walk frames by hopping frameLength; count every structurally valid frame,
  // tracking per-frame bitrates to classify CBR vs VBR. On a bad header mid-stream,
  // attempt a bounded resync; if that fails on substantial data, the stream is corrupt.
  let walked = 0;
  let bitrateSum = 0;
  let constantBitrate = true;
  let truncated = false;
  let corrupt = false;
  let audioHeader: Header | null = null; // first non-metadata frame — source of channel mode
  while (i + 4 <= end) {
    const h = parseHeader(bytes, i);
    if (h !== null && i + h.frameLength <= end) {
      walked++;
      if (audioHeader === null && !(walked === 1 && tag.kind !== "none")) audioHeader = h;
      bitrateSum += h.bitrateKbps;
      if (h.bitrateKbps !== first.bitrateKbps) constantBitrate = false;
      i += h.frameLength;
      continue;
    }
    if (h !== null) {
      truncated = true; // valid header but the frame body is cut off by end-of-input
      break;
    }
    const next = resync(bytes, i, end);
    if (next === -1) {
      if (end - i >= MAX_FRAME_LENGTH) corrupt = true; // substantial unrecoverable garbage
      break;
    }
    corrupt = true; // skipped a non-frame gap to the next confirmed frame
    i = next;
  }

  const framesIncludingHeader = walked;
  const frameCount = tag.kind === "none" ? walked : walked - 1;
  const durationSeconds = (frameCount * SAMPLES_PER_FRAME) / first.sampleRate;
  // Equal frame duration (1152 samples) => the time-average bitrate is the mean of per-frame bitrates.
  const bitrate: Bitrate = constantBitrate
    ? { mode: "cbr", kbps: first.bitrateKbps }
    : { mode: "vbr", averageKbps: Math.round(bitrateSum / walked) };

  return {
    ok: true,
    analysis: {
      frameCount,
      framesIncludingHeader,
      durationSeconds,
      sampleRate: first.sampleRate,
      channelMode: (audioHeader ?? first).channelMode,
      bitrate,
      header: tag,
      flags: { truncated, corrupt },
    },
  };
}
