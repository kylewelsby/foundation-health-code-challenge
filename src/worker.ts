/**
 * Cloudflare Worker exposing POST /file-upload. A thin HTTP adapter over the pure
 * analyzeMp3 library — all MP3 logic lives there; this file only does HTTP concerns.
 * See ADR 0002 for the 25 MB cap and the streaming/scale-out rationale.
 */
import { docsHtml } from "./docs";
import { type AnalyzeError, analyzeMp3, type FrameAnalysis } from "./lib/mp3/analyze";
import { openapi } from "./openapi";

const MAX_BYTES = 25 * 1024 * 1024; // raise toward the 100 MB Free body limit once a deploy confirms CPU (ADR 0002)

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
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

async function handleUpload(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) return fail(413, "too-large", `Upload exceeds the ${MAX_BYTES}-byte limit.`);

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
  if (field.size > MAX_BYTES) return fail(413, "too-large", `Upload exceeds the ${MAX_BYTES}-byte limit.`);

  const result = analyzeMp3(new Uint8Array(await field.arrayBuffer()));
  return result.ok ? json(200, result.analysis) : json(parseErrorStatus(result.error.code), { error: result.error });
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  // The Svelte SPA (dist/) is served by Workers Assets; this handler owns the API routes.
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/file-upload":
        return request.method === "POST" ? handleUpload(request) : fail(405, "method-not-allowed", "Use POST.");
      case "/openapi.json":
        return new Response(JSON.stringify(openapi), { headers: { "content-type": "application/json" } });
      case "/docs":
        return html(docsHtml);
      default:
        return fail(404, "not-found", "Not found. POST an MP3 to /file-upload, or see /docs.");
    }
  },
};
