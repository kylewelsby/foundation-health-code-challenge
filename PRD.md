# PRD — MP3 Frame Analysis App

Build spec consolidating the grilled decisions. Reasoning lives in
[CONTEXT.md](CONTEXT.md) (glossary) and [docs/adr/](docs/adr/) (decisions); this
document is the *what to build* and *how we know it's done*.

## 1. Objective

A deployable HTTP API that accepts an MP3 upload at **`POST /file-upload`** and
returns the number of **MPEG-1 Audio Layer III** frames, plus bonus metadata.
Correctness and code quality are judged as much as the result.

## 2. Scope

- **In scope:** MPEG Version 1, Layer III streams (the near-universal `.mp3`).
- **Out of scope, rejected gracefully (not miscounted, not crashed):** other MPEG
  versions/layers, free-format. Per the assessment, do **not** over-invest here —
  one clear rejection path, not per-variant polish.

## 3. Frame-count definition — the headline number

`frameCount` = **audio frames, EXCLUDING the Xing/Info/VBRI header frame**. See
[ADR 0001](docs/adr/0001-framecount-excludes-header-frame.md). On the provided VBR
`sample.mp3` this is **6089** — matching mediainfo (the spec's verification tool),
ffprobe, and the Xing declared count. The structural total (incl. header) is exposed
as `framesIncludingHeader`.

Oracles: **mediainfo** (spec-suggested) and ffprobe both report 6089 for the sample;
the Xing field declares 6089. ffprobe excludes the header frame consistently; we match
it. mediainfo's quirk of counting the Info frame for *CBR* is documented, not followed.

## 4. Response contract

`200` success — JSON, `Content-Type: application/json`, a **superset** with
`frameCount` always **top-level, exactly named, a number**:

```ts
type FrameAnalysis = {
  frameCount: number;             // audio frames, EXCLUDES header frame — the required key
  framesIncludingHeader: number;  // structural total (frameCount + 1 when a header frame present)
  durationSeconds: number;        // frameCount * 1152 / sampleRate (display duration, float)
  sampleRate: number;             // Hz
  channelMode: "stereo" | "joint_stereo" | "dual_channel" | "mono";
  bitrate:
    | { mode: "cbr"; kbps: number }
    | { mode: "vbr"; averageKbps: number; nominalKbps?: number };
  header: { kind: "xing" | "info" | "vbri" | "none"; declaredFrameCount?: number };
  flags: { truncated: boolean; corrupt: boolean };
};
```

Error — JSON, correct status: `{ error: { code: string; message: string } }`.
No `?strict` toggle (it wouldn't defend an automated deep-equal grader anyway).

## 5. Error & edge-case matrix

| Condition | Status | Notes |
| --- | --- | --- |
| No file / wrong field / non-multipart | 400 | named message |
| Empty / zero-byte file | 400 | |
| Over the size cap | 413 | early-abort at threshold, don't buffer past it |
| Non-MP3 (zero valid frames) | 400 | `.txt` renamed `.mp3`, JPEG, etc. — *not* a `frameCount: 0` |
| Out-of-scope MPEG version/layer | 400 | graceful, named; not a miscount |
| Free-format (bitrate index `0000`) | 400 | also a loop-guard: `frameLen ≤ 4 ⇒ bail` |
| ≥1 valid frame then unrecoverable garbage | 200 | return count-so-far, `flags.corrupt = true` |
| Truncated final frame | 200 | drop it, `flags.truncated = true` |

Always: clean errors, no stack traces, useful messages.

## 6. Parser behaviour (pure, dependency-free, fully typed, stream-shaped)

- **Header-hop, not byte-scan:** read 4-byte header, compute `frameLength =
  144·bitrate/sampleRate + padding`, jump it. `O(frameCount)` CPU, never reads payload.
- **Sync:** 11 set bits + version `11` + layer `01`. Reject invalid bitrate `1111`
  / samplerate `11` as false sync.
- **Resync:** on a bad header mid-stream, scan forward via native `indexOf`,
  **bounded**, accept a candidate only with **2-frame confirmation**. Bounded scan
  also caps worst-case CPU.
- **ID3v2** at front: read 10-byte header + syncsafe (28-bit) size, skip `10 + size`.
- **ID3v1** trailer: stop 128 bytes early if last 128 start with `TAG`.
- **Truncated final frame:** drop, flag. **Corrupt:** count-so-far, flag.
- The parser is a standalone library; the Worker endpoint is a thin adapter over it.

## 7. Scalability — see [ADR 0002](docs/adr/0002-workers-free-stream-hop-and-scale-ladder.md)

- Target **Cloudflare Workers Free**. Stream the multipart body off `request.body`.
- **Cap = 25 MB** (defensible without deploying) + 413; raise toward the 100 MB Free
  body limit only after a deployed Worker's CPU metric confirms ingestion fits 10 ms.
- Ingestion (`O(bytes)`) dominates parsing; documented ladder beyond the cap:
  embed the lib → chunked-to-R2 + async → Containers → plan bump. Rust→WASM is a
  documented constant-factor lever (TS remains the deliverable per spec).

## 8. Test fixtures & oracles (ffmpeg/lame-generated; silence/tone; committable)

**Primary fixture: the provided `sample.mp3`** (VBR/Xing, MPEG-1 L3, joint stereo,
44.1 kHz) → `frameCount` **6089**. Plus: CBR MPEG-1 L3 · VBR with Xing (count ==
declared) · large ID3v2 (+cover) · ID3v1 trailer · no-tag CBR · out-of-scope
(MPEG-2 / Layer II) · garbage (`.txt` renamed, empty, zero-byte, truncated,
free-format). Cross-check every count against **mediainfo** and **ffprobe**.

## 9. Acceptance criteria (each → a test)

1. `POST /file-upload` with the provided `sample.mp3` → `200`, `frameCount === 6089`
   (== mediainfo == ffprobe == Xing declared).
2. VBR-with-Xing → `frameCount === declaredFrameCount` (header excluded);
   `framesIncludingHeader === frameCount + 1`.
3. Large ID3v2 tag skipped → count unaffected.
4. ID3v1 trailer not walked into.
5. `frameCount` is top-level, exact-named, numeric, with `application/json`.
6. No file / empty / oversize → 400 / 400 / 413 with clean JSON errors.
7. Non-MP3 / out-of-scope / free-format → 400, named, never a miscount or crash.
8. Truncated → `200`, `flags.truncated`. Corrupt-after-frames → `200`, `flags.corrupt`.
9. Parser unit-tests run with **no Worker/DOM deps**; `tsc --noEmit` passes (no `any`/`unknown`).

## 10. Build order

Parser (TDD, `bun test`) → fixtures + mediainfo cross-check → `/file-upload` **plain
Cloudflare Worker** (`wrangler dev`, no framework) → GitHub Actions CI (`tsc --noEmit`,
ESLint, Prettier, `bun test`, `wrangler deploy --dry-run`) → minimal UI + OpenAPI →
README (decisions, tradeoffs, AI-assistance note) → `wrangler deploy`, measure CPU,
finalize cap.

Stack note: the brief floated SvelteKit; the implementation is a **plain Worker** — a
single API endpoint needs no framework, and Bun + `wrangler dev` keeps the toolchain
minimal (no Node). A UI bonus, if built, is a static page served by the Worker.

## 11. Non-goals

Persistence/R2 · full ID3 tag decoding · gapless (sample-exact) duration · other
MPEG versions/layers · UI dazzle. AI assistance used; solution is owned and defensible.
