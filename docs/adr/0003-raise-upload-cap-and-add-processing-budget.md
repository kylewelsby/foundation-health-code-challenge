# Raise upload cap to 100 MB and add a 5 s parsing deadline

The production endpoint now accepts uploads up to the **Cloudflare Workers Free**
request-body limit (**100 MB**) and bounds in-isolate parsing with a **5 s**
wall-clock deadline. The cap, its human-readable label, and the processing budget
are single-sourced in `src/lib/limits.ts` so the Worker (enforcement), the
OpenAPI spec, and the Svelte UI (client-side pre-check) stay in sync.

## Context

ADR 0002 established a **25 MB default cap** with the explicit condition that it
would be raised toward the 100 MB Free body limit only after a deployed Worker's
CPU metric confirmed ingestion fit the 10 ms CPU budget. Deployment data showed
the buffered `formData()` path (the one currently in production) comfortably
handles the full 100 MB body within the Workers Free constraints, so the cap can
be raised.

Raising the cap introduces a new failure mode: a pathological or runaway stream
could consume excessive wall-clock time before the platform's hard 10 ms CPU
limit terminates the isolate. That termination is uncatchable and returns a
blank 503 to the caller. A voluntary, in-isolate deadline lets us return a
**structured 503** instead and keeps the failure observable and debuggable.

Key constraints:

- Workers Free hard CPU limit is **10 ms** per invocation; it cannot be caught.
- Workers Free request-body limit is **100 MB**.
- Parsing a well-formed 100 MB MP3 is single-digit milliseconds of CPU; the 5 s
  budget is therefore a generous backstop, not a performance target.
- The parser is pure and synchronous, so the deadline is checked at coarse
  intervals during header scanning and frame hopping to avoid a per-byte clock
  read.

## Decision

- **Raise `MAX_UPLOAD_BYTES` to 100 MB**, matching the Workers Free body limit.
- **Add `PROCESSING_BUDGET_MS = 5_000`** as a wall-clock backstop for parsing.
- **Pass an absolute `deadline` into `analyzeMp3`**. If either the initial sync
  scan or the frame hop exceeds the deadline, return an `AnalyzeError` with code
  `"timeout"`; the Worker maps this to HTTP **503 Service Unavailable**.
- **Single-source the limits** in `src/lib/limits.ts`:
  - `MAX_UPLOAD_BYTES` / `MAX_UPLOAD_LABEL` are consumed by the Worker, the
    OpenAPI spec, the UI pre-check, and the worker tests.
  - `PROCESSING_BUDGET_MS` is consumed by the Worker and documented in the ADR.
- **Add client-side validation** in the Svelte UI: the drop zone disables submit
  and shows a destructive hint as soon as a selected file exceeds
  `MAX_UPLOAD_BYTES`.
- **Clamp `frameCount` to 0** when the only parsed frame is a truncated Xing/Info
  header frame. This prevents a negative count if the stream contains a valid
  header but no full audio frame.

## Consequences

- Uploads between 25 MB and 100 MB are now accepted, widening the useful range
  of the hosted endpoint.
- A pathological stream that cannot be counted within 5 s degrades to a clean,
  structured 503 instead of an opaque platform-terminated 503.
- The 5 s budget does **not** protect against the Workers Free 10 ms CPU hard
  limit for CPU-bound inputs; it only guards against wall-clock stalls inside the
  parser. The scale-out ladder in ADR 0002 still applies for files that cannot be
  processed server-side.
- Client-side validation reduces unnecessary uploads but is not a security
  boundary; the Worker re-validates the size before parsing.
- All size-related strings ("100 MB") flow from `MAX_UPLOAD_LABEL`, eliminating
  drift between the UI, spec, error messages, and tests.
