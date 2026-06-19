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
  | { readonly mode: "vbr"; readonly averageKbps: number };

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

export type AnalyzeErrorCode = "empty" | "not-mpeg1-layer3" | "free-format" | "timeout";

export type AnalyzeError = { readonly code: AnalyzeErrorCode; readonly message: string };

export type AnalyzeResult =
  | { readonly ok: true; readonly analysis: FrameAnalysis }
  | { readonly ok: false; readonly error: AnalyzeError };

/** Parse options. `deadline` is an absolute `Date.now()` ms after which parsing aborts gracefully. */
export type AnalyzeOptions = { readonly deadline?: number };

const TIMEOUT: AnalyzeResult = {
  ok: false,
  error: { code: "timeout", message: "File too large to count within the time budget." },
};

type Header = { bitrateKbps: number; sampleRate: number; channelMode: ChannelMode; frameLength: number };

/** Byte offset of the first audio frame past an ID3v2 tag, or 0 if none. */
function id3v2End(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  // Size is a 28-bit syncsafe integer (7 bits per byte) and excludes the 10-byte header.
  const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  return 10 + size;
}

// The three honest outcomes of looking at 4 bytes — so callers never have to
// re-derive "was that null a free-format frame or just noise?".
type HeaderScan = { status: "frame"; header: Header } | { status: "free-format" } | { status: "none" };
const NONE: HeaderScan = { status: "none" };
const FREE_FORMAT: HeaderScan = { status: "free-format" };

/** Cheap periodic deadline check; `counter` is incremented by the caller. */
function deadlineExceeded(deadline: number | undefined, counter: number, interval: number): boolean {
  return deadline !== undefined && counter % interval === 0 && Date.now() > deadline;
}

/** Classify the 4 bytes at `i` as a MPEG-1 Layer III frame, a free-format frame, or not a frame. */
function scanHeader(b: Uint8Array, i: number): HeaderScan {
  if (i + 4 > b.length) return NONE;
  if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return NONE; // 11-bit sync
  if (((b[i + 1]! >> 3) & 0x3) !== 0x3 || ((b[i + 1]! >> 1) & 0x3) !== 0x1) return NONE; // MPEG-1, Layer III
  const sampleRate = SAMPLE_RATE[(b[i + 2]! >> 2) & 0x3]!;
  if (sampleRate <= 0) return NONE; // reserved sample rate
  const bitrateIndex = (b[i + 2]! >> 4) & 0xf;
  if (bitrateIndex === 0x0) return FREE_FORMAT; // bitrate index 0000
  if (bitrateIndex === 0xf) return NONE; // bitrate index 1111 ("bad")
  const bitrateKbps = BITRATE_KBPS[bitrateIndex]!;
  const padding = (b[i + 2]! >> 1) & 0x1;
  const channelMode = CHANNEL_MODES[(b[i + 3]! >> 6) & 0x3]!;
  const frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  return { status: "frame", header: { bitrateKbps, sampleRate, channelMode, frameLength } };
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

/** A frame at `i` whose following frame also parses (2-frame confirmation guards false syncs). */
function isConfirmedFrame(b: Uint8Array, i: number, end: number): boolean {
  const scan = scanHeader(b, i);
  if (scan.status !== "frame" || i + scan.header.frameLength > end) return false;
  const next = i + scan.header.frameLength;
  return next + 4 > end || scanHeader(b, next).status === "frame"; // nothing after => accept
}

/** Bounded forward scan (native indexOf over 0xFF) for the next confirmed frame past garbage. */
function resync(b: Uint8Array, from: number, end: number): number {
  const bound = Math.min(end, from + RESYNC_BOUND);
  let i = from + 1;
  while (i < bound) {
    const idx = b.indexOf(0xff, i);
    if (idx === -1 || idx >= bound) return -1;
    if (isConfirmedFrame(b, idx, end)) return idx;
    i = idx + 1;
  }
  return -1;
}

export function analyzeMp3(bytes: Uint8Array, options: AnalyzeOptions = {}): AnalyzeResult {
  if (bytes.length === 0) {
    return { ok: false, error: { code: "empty", message: "File is empty." } };
  }
  const { deadline } = options;

  // Skip any ID3v2 tag (so cover-art bytes can't false-sync), then jump between 0xFF
  // candidates (native indexOf — the same strategy as resync) to find the first frame,
  // classifying free-format vs non-MP3 along the way.
  let first: Header | null = null;
  let firstOffset = -1;
  let scans = 0;
  for (let idx = bytes.indexOf(0xff, id3v2End(bytes)); idx !== -1; idx = bytes.indexOf(0xff, idx + 1)) {
    if (deadlineExceeded(deadline, scans++, 16384)) return TIMEOUT;
    const scan = scanHeader(bytes, idx);
    if (scan.status === "free-format") {
      return { ok: false, error: { code: "free-format", message: "Free-format MP3 is not supported." } };
    }
    if (scan.status === "frame") {
      first = scan.header;
      firstOffset = idx;
      break;
    }
  }
  if (first === null) {
    return { ok: false, error: { code: "not-mpeg1-layer3", message: "No MPEG-1 Layer III frames found." } };
  }
  const tag = parseHeaderTag(bytes, firstOffset, first.frameLength);
  const end = audioEnd(bytes);

  // Channel mode comes from an audio frame, not the header frame: a Xing/Info frame is
  // often plain stereo even when the audio is joint stereo. Read the frame after the header.
  let channelMode = first.channelMode;
  if (tag.kind !== "none") {
    const afterHeader = scanHeader(bytes, firstOffset + first.frameLength);
    if (afterHeader.status === "frame") channelMode = afterHeader.header.channelMode;
  }

  // Hop frame-by-frame from the first frame, counting and classifying CBR/VBR. A bad header
  // triggers a bounded resync; substantial unrecoverable garbage marks the stream corrupt.
  let i = firstOffset;
  let walked = 0;
  let bitrateSum = 0;
  let constantBitrate = true;
  let truncated = false;
  let corrupt = false;
  let iterations = 0;
  while (i + 4 <= end) {
    if (deadlineExceeded(deadline, iterations++, 8192)) return TIMEOUT;
    const scan = scanHeader(bytes, i);
    if (scan.status === "frame") {
      if (i + scan.header.frameLength > end) {
        truncated = true; // valid header but the frame body is cut off by end-of-input
        break;
      }
      walked++;
      bitrateSum += scan.header.bitrateKbps;
      if (scan.header.bitrateKbps !== first.bitrateKbps) constantBitrate = false;
      i += scan.header.frameLength;
      continue;
    }
    const next = resync(bytes, i, end);
    if (next === -1) {
      if (end - i >= MAX_FRAME_LENGTH) corrupt = true; // substantial unrecoverable garbage
      break;
    }
    corrupt = true; // skipped a non-frame gap to the next confirmed frame
    i = next;
  }

  // Exclude the Xing/Info/VBRI header frame — but only when one was actually walked
  // (a truncated header-only stream leaves walked == 0; never emit a negative count).
  const hasHeaderFrame = tag.kind !== "none" && walked > 0;
  const frameCount = hasHeaderFrame ? walked - 1 : walked;
  return {
    ok: true,
    analysis: {
      frameCount,
      framesIncludingHeader: walked,
      // Equal frame duration (1152 samples) => time-average bitrate is the mean of frame bitrates.
      durationSeconds: (frameCount * SAMPLES_PER_FRAME) / first.sampleRate,
      sampleRate: first.sampleRate,
      channelMode,
      bitrate: constantBitrate
        ? { mode: "cbr", kbps: first.bitrateKbps }
        : { mode: "vbr", averageKbps: Math.round(bitrateSum / walked) },
      header: tag,
      flags: { truncated, corrupt },
    },
  };
}
