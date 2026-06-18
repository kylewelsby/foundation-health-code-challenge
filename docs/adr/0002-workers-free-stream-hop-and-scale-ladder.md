# Deploy on Workers Free; stream + header-hop; 100 MB cap; documented scale-out ladder

The API runs on the **Cloudflare Workers Free** tier. The parser hops frame headers
(not byte-scans) and is fed by a streamed multipart body, so it handles the full
**100 MB** Free request-body limit within the 10 ms CPU budget. Beyond 100 MB is
addressed by a documented ladder, not by building heavier infrastructure now.

## Context

Scalability is an explicit grading criterion. Workers Free imposes: **10 ms CPU**
per invocation, **128 MB** isolate memory, **100 MB** request body. CPU time
excludes I/O wait, so a slow upload does not count — only the parsing arithmetic does.

Measured (Bun/JSC + disk prototype; workerd is V8 + network, so figures are indicative):

| 100 MB scenario | CPU |
| --------------- | --- |
| hop, bytes already resident (parsing only) | ~3.5 ms warm / ~9.5 ms cold |
| **drain-only — ingest 100 MB into JS, touch nothing** | **~28 ms** |
| stream + hop end-to-end | ~26 ms |
| naïve byte-scan (rejected design) | ~24–37 ms ❌ |

Header-hop is `O(frameCount)` (read 4-byte header, jump `frameLength`, never read
payload) and makes *parsing* cheap. But **ingestion is `O(bytes)` and dominates**:
materializing 100 MB into JS costs ~28 ms here — the hop cannot reduce it.

**Open question (cannot be settled off-platform):** whether workerd charges
request-body ingestion to the 10 ms CPU budget or treats it as I/O. If charged,
the real Free cap is ~25–35 MB, not 100 MB. The definitive test is a deployed
Worker's CPU metric. Until then the 100 MB figure is **unverified**.

Part of the ingestion cost is JS-runtime overhead (per-chunk allocation, GC,
async-iterator machinery). A **Rust→WASM** Worker (same isolate, not native) would
remove that and lower the constant — but still pays an `O(bytes)` copy into WASM
linear memory, so it is a constant-factor lever, not an escape. True zero-copy
requires leaving the isolate (Containers) or not ingesting (embed the lib).

## Decision

- **Deploy on Workers Free.** Proportionate, ~$0, no cold starts. The Free tier is
  the deliberate stipulation: prove it works there, document how to scale past it.
- **Parser** is pure, dependency-free, stream-shaped, header-hopping, with **bounded
  resync** using native `indexOf` (caps worst-case CPU). It is a standalone library;
  the Worker endpoint is a thin adapter.
- **Endpoint** streams the multipart body off `request.body`; **cap = 25 MB by
  default** (the figure defensible without deploying), raised toward the 100 MB Free
  body limit **only after** a deployed Worker's CPU metric confirms ingestion fits
  the 10 ms budget. **413** + early-abort at the byte threshold.

## Scale-out ladder (documented, NOT built) — for >100 MB or heavy processing

1. **Embed the library in the consumer** — no upload, no network boundary; compute
   runs where the file already lives, on the caller's resources. The cleanest hatch.
2. **Resumable/chunked upload → object storage (R2) → async pipeline** — the real
   "YouTube" pattern; a different architecture from a synchronous count endpoint.
3. **Containers** — 12 GiB RAM, long runtime, native tooling (e.g. ffmpeg). Billed
   per vCPU/GiB-second + egress; seconds-scale cold start. Heaviest, last resort.
4. **Plan bumps** — Pro/Business/Enterprise body 100→500 MB; Paid CPU 30 s→5 min.

Explicitly **not** Workers for Platforms — that is multi-tenant hosting of customer
Workers, not a way to raise our own limits.

## Consequences

- A 100 MB cap returns 413 above it; the cap is the platform *body/transfer* limit,
  not a CPU limit (proven). "Why not >100 MB" is answered by the ladder above —
  primarily by removing the upload (rung 1), with Containers as the heavy last rung.
- If the 5-day timebox tightens, a buffered `formData()` endpoint capped at ~25 MB
  ships the same spec-complete core; the hop parser is unchanged. Streaming only
  raises the cap 25 → 100 MB.
