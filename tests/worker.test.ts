import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import worker from "../src/worker";

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

test("oversize upload -> 413", async () => {
  const res = await worker.fetch(uploadOf(new Uint8Array(26 * 1024 * 1024))); // > 25 MB cap
  expect(res.status).toBe(413);
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

test("GET /docs serves the API reference page", async () => {
  const res = await worker.fetch(new Request("http://localhost/docs"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("/openapi.json");
});

test("GET /privacy serves the privacy policy", async () => {
  const res = await worker.fetch(new Request("http://localhost/privacy"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("Privacy Policy");
  expect(body).toContain("mekyle.com");
});
