# MP3 Frame Analysis

An HTTP API and Svelte web UI that accept an MP3 upload and return the number of
**MPEG-1 Audio Layer III** frames in it, plus bonus metadata. The frame parser is
hand-written (no MP3-parsing dependency), pure, and fully typed. The UI also previews
the uploaded file with a scrubbable audio player that shows the current playback frame.

```bash
curl -X POST -F "file=@tests/fixtures/sample.mp3" http://localhost:8787/file-upload
# {"frameCount":6089, ...}
```

## Quick start

Prerequisites: [mise](https://mise.jdx.dev) (pins the toolchain) — or just
[Bun](https://bun.sh) ≥ 1.3 directly. **No Node required.**

```bash
mise install          # installs Bun (the only pinned tool)
bun install           # installs wrangler + dev dependencies

bun run build         # builds the Svelte UI (web/ -> dist/)
bun run dev           # serves the UI + API on workerd via `wrangler dev` (:8787)

bun test              # parser + endpoint test suites
bun run typecheck     # tsc --noEmit (strict; no `any`/`unknown`)
bun run check:svelte  # svelte-check (UI types)
bun run lint          # Biome (lint + format)
```

Open **http://localhost:8787** for the upload UI, or hit the endpoint directly:

```bash
curl -X POST -F "file=@tests/fixtures/sample.mp3" http://localhost:8787/file-upload
```

Interactive API reference (Scalar) is at **`/docs`**; the raw spec at **`/openapi.json`**.
For UI development with hot reload, run `bun run dev:web` (Vite, proxies the API to `wrangler dev`).

## Web UI

The home page is a drag-and-drop upload UI. It shows client-side size validation,
an upload progress bar, the analyzed frame count, and — after a successful upload —
a player with a scrub bar that displays the current **playback frame** and elapsed
duration while the audio is playing or scrubbing.

## Routes

| Route | Purpose |
| ----- | ------- |
| `GET /` | Svelte upload UI (served from `dist/` via Workers Assets) |
| `POST /file-upload` | the API — count frames in an uploaded MP3 |
| `GET /docs` | interactive API reference (Scalar) |
| `GET /openapi.json` | OpenAPI 3.1 spec |
| `GET /privacy` | privacy policy (no-persistence statement) |

## API

### `POST /file-upload`

Multipart form upload; the MP3 must be sent as the **`file`** field.

**`200 OK`** — JSON (a superset; `frameCount` is always present, top-level, numeric):

```jsonc
{
  "frameCount": 6089,            // audio frames — the required value
  "framesIncludingHeader": 6090, // structural total (incl. the Xing/Info/VBRI header frame)
  "durationSeconds": 159.0596,   // frameCount * 1152 / sampleRate (display duration)
  "sampleRate": 44100,
  "channelMode": "joint_stereo",
  "bitrate": { "mode": "vbr", "averageKbps": 73 },
  "header": { "kind": "xing", "declaredFrameCount": 6089 },
  "flags": { "truncated": false, "corrupt": false }
}
```

**Errors** — JSON `{ "error": { "code", "message" } }` with a meaningful status:

| Status | When |
| ------ | ---- |
| `400` | no `file` field · empty file · body isn't multipart |
| `413` | upload exceeds the 100 MB limit |
| `415` | not MPEG-1 Layer III (wrong MPEG version/layer, free-format, or not an MP3) |
| `405` | method isn't `POST` |
| `404` | path isn't `/file-upload` |

A **corrupt** stream (valid frames then unrecoverable garbage) and a **truncated**
final frame still return `200` with the count so far and `flags.corrupt` /
`flags.truncated` set — they are not errors.

## How the count works

The parser finds the 4-byte frame header (11-bit sync + MPEG-1 + Layer III), reads
the bitrate/sample-rate/padding, computes `frameLength = 144·bitrate/sampleRate +
padding`, and **hops** to the next header — it never reads the payload, so counting
is `O(frames)`, not `O(bytes)`. It skips ID3v2 tags (syncsafe size), ignores the
ID3v1 trailer, classifies CBR vs VBR, and resyncs (bounded, with 2-frame
confirmation) across corruption.

**`frameCount` excludes the Xing/Info/VBRI header frame.** On the provided
`sample.mp3` (VBR) that's **6089** — matching `mediainfo` (the assessment's suggested
verification tool), `ffprobe`, and the file's own Xing declared count. The structural
total (6090) is exposed as `framesIncludingHeader`. Full reasoning, including the
tool disagreement on CBR files, is in
[ADR 0001](docs/adr/0001-framecount-excludes-header-frame.md).

## Design decisions & tradeoffs

- **Hand-written parser, pure library.** [`src/lib/mp3/analyze.ts`](src/lib/mp3/analyze.ts)
  has no Worker/DOM/Node dependencies — unit-testable in isolation and embeddable by
  any consumer. The Worker is a thin HTTP adapter over it.
- **Plain Cloudflare Worker (not SvelteKit).** A single API endpoint needs no
  framework; Bun + `wrangler dev` keeps the toolchain minimal.
- **Cloudflare Workers Free.** Near-zero cost, no cold starts, single-command deploy.
  Constraints (128 MB memory, 10 ms CPU, 100 MB body) and the scale-out ladder are in
  [ADR 0002](docs/adr/0002-workers-free-stream-hop-and-scale-ladder.md).
- **100 MB upload cap → `413`.** The cap matches the Cloudflare Workers Free request-body
  limit. A 5 s in-isolate parsing budget provides a graceful 503 backstop for pathological
  streams. See [ADR 0002](docs/adr/0002-workers-free-stream-hop-and-scale-ladder.md) and
  [ADR 0003](docs/adr/0003-raise-upload-cap-and-add-processing-budget.md) for the ladder
  and the cap-raise rationale.
- **No persistence.** Uploaded audio is parsed in memory and discarded — storing it
  would raise copyright/legal questions for no benefit to a stateless analyzer.
- **Superset response.** Returning metadata alongside `frameCount` shows range while
  keeping the required key exact; documented rather than hidden behind a flag.
- **Out-of-scope formats** (other MPEG versions/layers, free-format) are rejected
  gracefully (`415`), never miscounted.

## Scalability

Counting is `O(frames)` via header-hopping (a 100 MB file is low-single-digit ms of
parsing CPU); a bounded, `indexOf`-based resync caps worst-case CPU on garbage. The
cap is set by the platform's body limit and ingestion cost, not the algorithm. Beyond
the cap, the documented ladder is: embed the library (no upload) → chunked upload to
R2 + async → Cloudflare Containers → plan bump. See ADR 0002.

## Deployment

CI deploys to Cloudflare Workers on every push to `main` (after the checks pass) — it
builds the SPA and runs `wrangler deploy`. The production Worker is served from
**https://mp3-frame-analysis.mekyle.com** (configured as a custom domain in
`wrangler.toml`). Two repo secrets are required
(**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN` — an API token with the **Edit Cloudflare Workers** template
  (Workers Scripts: Edit). Create it at **dash.cloudflare.com → My Profile → API Tokens**.
- `CLOUDFLARE_ACCOUNT_ID` — your account ID (only needed if the token spans multiple accounts).

To deploy manually instead: `wrangler login` then `bun run deploy` (builds + deploys).

CI deploys via the official **`cloudflare/wrangler-action@v4`**, which auto-detects
Bun (from `bun.lock`) and uses the project's locked `wrangler` v4 — the same version
as local dev and the build gate, so what's validated is what ships.

## Testing

`bun test` runs the parser suite and the endpoint suite against committed fixtures in
`tests/fixtures/` (CBR/VBR/ID3v2+cover/ID3v1/truncated/corrupt/free-format/MPEG-2/
Layer II, plus the real `sample.mp3`). Fixtures are `ffmpeg`/`lame`-generated from
silence or a tone (no copyright concern), and counts are cross-checked against
`mediainfo` and `ffprobe`.

## Project layout

```
src/lib/mp3/analyze.ts   # the pure, typed frame parser (the heart of the exercise)
src/worker.ts            # the Cloudflare Worker: routes /file-upload, /docs, /openapi.json
src/openapi.ts           # OpenAPI 3.1 spec
web/                     # Svelte 5 + Vite + Tailwind upload UI (builds to dist/)
tests/                   # bun test suites + fixtures
CONTEXT.md               # domain glossary
docs/adr/                # architecture decision records
PRD.md                   # build spec & acceptance criteria
```

## AI assistance

This solution was developed with AI assistance (Claude). The design decisions,
tradeoffs, and implementation are owned and understood by the author — the ADRs and
this README capture the reasoning so each choice can be defended unaided.
