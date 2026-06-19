import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyzeMp3 } from "../src/lib/mp3/analyze";

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

// Tracer: prove sync-find -> header-parse -> hop -> count end-to-end on the
// simplest real file (CBR, no Xing/Info tag, so every tool agrees on 40).
test("counts frames in a CBR MPEG-1 Layer III stream with no header tag", () => {
  const result = analyzeMp3(load("cbr_notag.mp3"));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.analysis.frameCount).toBe(40);
});

// The graded file: VBR with a Xing header. frameCount EXCLUDES the header frame,
// so it must equal mediainfo/ffprobe/Xing-declared = 6089 (structural 6090 - 1).
test("counts the provided sample.mp3 as 6089 (VBR, Xing header excluded)", () => {
  const result = analyzeMp3(load("sample.mp3"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.analysis.frameCount).toBe(6089);
    expect(result.analysis.framesIncludingHeader).toBe(6090);
    expect(result.analysis.header.kind).toBe("xing");
  }
});

// CBR with a LAME "Info" header — the header frame is excluded just like Xing.
// (We follow ffprobe = 40; mediainfo's 41 for CBR/Info is its documented quirk.)
test("excludes the Info header frame on a CBR file (40, structural 41)", () => {
  const result = analyzeMp3(load("cbr_1s.mp3"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.analysis.frameCount).toBe(40);
    expect(result.analysis.framesIncludingHeader).toBe(41);
    expect(result.analysis.header.kind).toBe("info");
  }
});

// VBR fixture: frameCount == Xing declared count (116); structural 117.
test("counts a VBR/Xing fixture as 116 (== declared), structural 117", () => {
  const result = analyzeMp3(load("vbr_3s.mp3"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.analysis.frameCount).toBe(116);
    expect(result.analysis.framesIncludingHeader).toBe(117);
    expect(result.analysis.header.kind).toBe("xing");
  }
});

test("rejects an empty file", () => {
  const r = analyzeMp3(new Uint8Array(0));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("empty");
});

test("rejects a non-MP3 (text renamed .mp3) as not-mpeg1-layer3", () => {
  const r = analyzeMp3(new TextEncoder().encode("this is definitely not an mp3 file at all, just text"));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("not-mpeg1-layer3");
});

test("rejects a free-format MP3 gracefully (bitrate index 0000)", () => {
  const r = analyzeMp3(load("freeformat.mp3"));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("free-format");
});

test("detects VBR and parses the Xing declared frame count", () => {
  const r = analyzeMp3(load("vbr_3s.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.bitrate.mode).toBe("vbr");
    expect(r.analysis.header.declaredFrameCount).toBe(116);
  }
});

test("detects CBR on a constant-bitrate file", () => {
  const r = analyzeMp3(load("cbr_notag.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.analysis.bitrate.mode).toBe("cbr");
});

test("skips an ID3v2 tag whose payload contains a fake frame sync", () => {
  const r = analyzeMp3(load("id3v2_fakesync.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(40);
    expect(r.analysis.header.kind).toBe("none");
  }
});

test("handles a real ID3v2 tag with cover art (count unaffected)", () => {
  const r = analyzeMp3(load("id3v2_cover.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.analysis.frameCount).toBe(40);
});

test("does not walk into an ID3v1 (128-byte TAG) trailer", () => {
  const r = analyzeMp3(load("id3v1_trailer.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.analysis.frameCount).toBe(40);
});

test("drops a truncated final frame and flags it (39 of 40)", () => {
  const r = analyzeMp3(load("truncated.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(39);
    expect(r.analysis.flags.truncated).toBe(true);
  }
});

test("resyncs across a garbage gap and flags corrupt", () => {
  const r = analyzeMp3(load("corrupt_gap.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(40);
    expect(r.analysis.flags.corrupt).toBe(true);
  }
});

test("resync skips false 0xFF syncs via 2-frame confirmation", () => {
  const r = analyzeMp3(load("corrupt_falsesync.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(40);
    expect(r.analysis.flags.corrupt).toBe(true);
  }
});

test("reports audio-frame metadata for the sample (joint stereo, 44.1k, ~159s, VBR)", () => {
  const r = analyzeMp3(load("sample.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    const a = r.analysis;
    expect(a.sampleRate).toBe(44100);
    expect(a.channelMode).toBe("joint_stereo"); // from an audio frame, not the Xing header frame
    expect(a.bitrate.mode).toBe("vbr");
    expect(a.durationSeconds).toBeCloseTo(159.06, 1);
  }
});

test("reports CBR mono metadata for the no-tag fixture", () => {
  const r = analyzeMp3(load("cbr_notag.mp3"));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.channelMode).toBe("mono");
    expect(r.analysis.bitrate).toEqual({ mode: "cbr", kbps: 128 });
  }
});

// A header-only VBR stream whose single (header) frame is truncated: parseHeaderTag still
// sees "Xing", but the frame body is cut off, so walked == 0. frameCount must clamp to 0,
// never -1 (regression guard for the header-frame subtraction).
test("clamps frameCount to 0 when the only frame is a truncated header frame", () => {
  // Valid MPEG-1 L3 header (0xFFFB, 128 kbps / 44.1 kHz => 417-byte frame), then ASCII
  // "Xing" with empty flags, then nothing — 12 bytes total, far short of one frame.
  const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x58, 0x69, 0x6e, 0x67, 0x00, 0x00, 0x00, 0x00]);
  const r = analyzeMp3(bytes);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.header.kind).toBe("xing");
    expect(r.analysis.framesIncludingHeader).toBe(0);
    expect(r.analysis.frameCount).toBe(0);
    expect(r.analysis.flags.truncated).toBe(true);
  }
});

test("rejects out-of-scope MPEG-2 Layer III gracefully", () => {
  const r = analyzeMp3(load("mpeg2_l3.mp3"));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("not-mpeg1-layer3");
});

test("rejects out-of-scope Layer II gracefully", () => {
  const r = analyzeMp3(load("layer2.mp3"));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("not-mpeg1-layer3");
});

// Build a minimal valid MPEG-1 Layer III frame (128 kbps, 44.1 kHz, stereo, no padding).
// Frame body is zeros; this is enough for the parser to sync and hop.
function makeFrame(): Uint8Array {
  const frameLength = Math.floor((144 * 128 * 1000) / 44100); // 417
  const frame = new Uint8Array(frameLength);
  frame[0] = 0xff; // sync
  frame[1] = 0xfb; // MPEG-1, Layer III
  frame[2] = 0x90; // 128 kbps, 44.1 kHz, no padding
  frame[3] = 0x00; // stereo
  return frame;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

test("flags corrupt when resync fails over substantial garbage", () => {
  const frame = makeFrame();
  // Valid frame, then 1500 zero bytes (no 0xFF at all, so resync returns -1 immediately).
  // The remaining gap exceeds MAX_FRAME_LENGTH, so the stream is marked corrupt.
  const garbage = new Uint8Array(1500).fill(0x00);
  const r = analyzeMp3(concat([frame, garbage]));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(1);
    expect(r.analysis.flags.corrupt).toBe(true);
    expect(r.analysis.flags.truncated).toBe(false);
  }
});

test("flags corrupt when resync bound is exceeded by 0xFF garbage", () => {
  const frame = makeFrame();
  // Valid frame, then 130 KiB of 0xFF bytes. resync scans up to its 128 KiB bound
  // without finding a confirmed frame, returns -1, and the leftover gap is substantial.
  const garbage = new Uint8Array(130 * 1024).fill(0xff);
  const r = analyzeMp3(concat([frame, garbage]));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.analysis.frameCount).toBe(1);
    expect(r.analysis.flags.corrupt).toBe(true);
  }
});
