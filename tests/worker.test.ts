import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../src/lib/limits";
import { createWorker } from "../src/worker";

const worker = createWorker();

type FrameBody = { frameCount: number };
type ErrorBody = { error: { code: string; message: string } };

function uploadOf(content: BlobPart, name = "audio.mp3"): Request {
  const form = new FormData();
  form.set("file", new File([content], name, { type: "audio/mpeg" }));
  return new Request("http://localhost/file-upload", { method: "POST", body: form });
}
function fixture(name: string): Request {
  return uploadOf(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))), name);
}

test("POST /file-upload returns frameCount 6089 for the sample, with JSON headers", async () => {
  const res = await worker.fetch(fixture("sample.mp3"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as FrameBody;
  expect(body.frameCount).toBe(6089);
});

test("rejects a non-MP3 upload with 415", async () => {
  const res = await worker.fetch(uploadOf(new TextEncoder().encode("not an mp3 at all")));
  expect(res.status).toBe(415);
  expect(((await res.json()) as ErrorBody).error.code).toBe("not-mpeg1-layer3");
});

test("missing file field -> 400", async () => {
  const res = await worker.fetch(new Request("http://localhost/file-upload", { method: "POST", body: new FormData() }));
  expect(res.status).toBe(400);
});

test("oversize upload -> 413 with a human-readable message", async () => {
  const res = await worker.fetch(uploadOf(new Uint8Array(MAX_UPLOAD_BYTES + 1))); // just over the cap
  expect(res.status).toBe(413);
  expect(((await res.json()) as ErrorBody).error.message).toContain(MAX_UPLOAD_LABEL);
});

test("non-POST method -> 405", async () => {
  const res = await worker.fetch(new Request("http://localhost/file-upload", { method: "GET" }));
  expect(res.status).toBe(405);
});

test("unknown path -> 404", async () => {
  const res = await worker.fetch(new Request("http://localhost/nope", { method: "POST" }));
  expect(res.status).toBe(404);
});

test("GET /openapi.json serves the OpenAPI spec", async () => {
  const res = await worker.fetch(new Request("http://localhost/openapi.json"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.paths["/file-upload"]).toBeDefined();
});

test("empty file upload -> 400", async () => {
  const res = await worker.fetch(uploadOf(new Uint8Array(0)));
  expect(res.status).toBe(400);
  expect(((await res.json()) as ErrorBody).error.code).toBe("empty");
});

test("pathological stream with zero budget -> 503 timeout", async () => {
  // 100 KiB of 0xFF bytes forces many sync scans (>16384) before a frame is found,
  // triggering the deadline check with a budget of 0 ms.
  const fastWorker = createWorker(0);
  const res = await fastWorker.fetch(uploadOf(new Uint8Array(100 * 1024).fill(0xff), "noise.mp3"));
  expect(res.status).toBe(503);
  expect(((await res.json()) as ErrorBody).error.code).toBe("timeout");
});

// /docs and /privacy are static files in dist/, served by Workers Assets (not the Worker) —
// covered by the build + the wrangler-dev integration check rather than a Worker unit test.
