import { test, expect } from "bun:test";
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
