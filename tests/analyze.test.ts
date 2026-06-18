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
