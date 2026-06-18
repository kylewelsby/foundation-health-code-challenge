/**
 * Pure, dependency-free MPEG-1 Audio Layer III frame analyzer.
 * No Worker/DOM deps — unit-testable and embeddable as a library.
 * See PRD.md and docs/adr/0001 (frameCount excludes the Xing/Info/VBRI header frame).
 */

export type ChannelMode = "stereo" | "joint_stereo" | "dual_channel" | "mono";

export type Bitrate =
  | { mode: "cbr"; kbps: number }
  | { mode: "vbr"; averageKbps: number; nominalKbps?: number };

export type HeaderKind = "xing" | "info" | "vbri" | "none";

export type FrameAnalysis = {
  frameCount: number;
  framesIncludingHeader: number;
  durationSeconds: number;
  sampleRate: number;
  channelMode: ChannelMode;
  bitrate: Bitrate;
  header: { kind: HeaderKind; declaredFrameCount?: number };
  flags: { truncated: boolean; corrupt: boolean };
};

export type AnalyzeErrorCode = "empty" | "not-mpeg1-layer3" | "free-format";

export type AnalyzeResult =
  | { ok: true; analysis: FrameAnalysis }
  | { ok: false; error: { code: AnalyzeErrorCode; message: string } };

// MPEG-1 Layer III lookup tables (index = header bits).
const BITRATE_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1] as const;
const SAMPLE_RATE = [44100, 48000, 32000, -1] as const;
const CHANNEL_MODES = ["stereo", "joint_stereo", "dual_channel", "mono"] as const;
const SAMPLES_PER_FRAME = 1152;

type Header = { bitrateKbps: number; sampleRate: number; channelMode: ChannelMode; frameLength: number };

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

/** Does the first frame carry a Xing/Info/VBRI metadata block? */
function detectHeaderKind(b: Uint8Array, frameStart: number, frameLength: number): HeaderKind {
  const end = Math.min(frameStart + frameLength, b.length);
  for (let i = frameStart + 4; i + 4 <= end; i++) {
    const tag = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    if (tag === "Xing") return "xing";
    if (tag === "Info") return "info";
    if (tag === "VBRI") return "vbri";
  }
  return "none";
}

export function analyzeMp3(bytes: Uint8Array): AnalyzeResult {
  if (bytes.length === 0) {
    return { ok: false, error: { code: "empty", message: "File is empty." } };
  }

  // Find the first valid in-scope frame, distinguishing free-format from non-MP3.
  let i = 0;
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

  const headerKind = detectHeaderKind(bytes, i, first.frameLength);

  // Walk frames by hopping frameLength; count every structurally valid frame.
  let walked = 0;
  while (true) {
    const h = parseHeader(bytes, i);
    if (h === null) break;
    if (i + h.frameLength > bytes.length) break; // truncated final frame — not counted
    walked++;
    i += h.frameLength;
  }

  const framesIncludingHeader = walked;
  const frameCount = headerKind === "none" ? walked : walked - 1;
  const durationSeconds = (frameCount * SAMPLES_PER_FRAME) / first.sampleRate;

  return {
    ok: true,
    analysis: {
      frameCount,
      framesIncludingHeader,
      durationSeconds,
      sampleRate: first.sampleRate,
      channelMode: first.channelMode,
      bitrate: { mode: "cbr", kbps: first.bitrateKbps },
      header: { kind: headerKind },
      flags: { truncated: false, corrupt: false },
    },
  };
}
