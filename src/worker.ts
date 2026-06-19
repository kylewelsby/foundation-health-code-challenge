/**
 * Cloudflare Worker exposing POST /file-upload. A thin HTTP adapter over the pure
 * analyzeMp3 library — all MP3 logic lives there; this file only does HTTP concerns.
 * See ADR 0002 / ADR 0003 for the cap and scale-out rationale.
 */
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, PROCESSING_BUDGET_MS } from "./lib/limits";
import { type AnalyzeError, analyzeMp3, type FrameAnalysis } from "./lib/mp3/analyze";
import { openapi } from "./openapi";

type ErrorBody = { error: { code: string; message: string } };

function json(status: number, body: FrameAnalysis | ErrorBody): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

/** HTTP status for each parser rejection — exhaustive, so a new error code won't compile until mapped. */
function parseErrorStatus(code: AnalyzeError["code"]): number {
  switch (code) {
    case "empty":
      return 400;
    case "not-mpeg1-layer3":
    case "free-format":
      return 415; // Unsupported Media Type
    case "timeout":
      return 503; // Service Unavailable — couldn't finish within the processing budget
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

export function createWorker(processingBudgetMs = PROCESSING_BUDGET_MS) {
  async function handleUpload(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES)
      return fail(413, "too-large", `Upload exceeds the ${MAX_UPLOAD_LABEL} limit.`);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "not-multipart", "Expected a multipart/form-data upload.");
    }

    const field = form.get("file");
    if (field === null || typeof field === "string") {
      return fail(400, "no-file", "No file found in the upload (send it as a 'file' field).");
    }
    if (field.size > MAX_UPLOAD_BYTES) return fail(413, "too-large", `Upload exceeds the ${MAX_UPLOAD_LABEL} limit.`);

    // Bound parsing with a deadline so a pathological stream degrades to a clean 503 rather
    // than spinning. The platform's CPU limit still governs the largest files (see ADR 0003).
    const bytes = new Uint8Array(await field.arrayBuffer());
    const result = analyzeMp3(bytes, { deadline: Date.now() + processingBudgetMs });
    return result.ok ? json(200, result.analysis) : json(parseErrorStatus(result.error.code), { error: result.error });
  }

  return {
    // The SPA and static pages (/, /docs, /privacy) are served from dist/ by Workers Assets;
    // this handler owns only the dynamic API routes.
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      switch (pathname) {
        case "/file-upload":
          return request.method === "POST" ? handleUpload(request) : fail(405, "method-not-allowed", "Use POST.");
        case "/openapi.json":
          return new Response(JSON.stringify(openapi), { headers: { "content-type": "application/json" } });
        default:
          return fail(404, "not-found", "Not found. POST an MP3 to /file-upload, or see /docs.");
      }
    },
  };
}

export default createWorker();
