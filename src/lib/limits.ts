/**
 * Upload + processing limits for POST /file-upload, shared by the Worker (enforcement),
 * the OpenAPI spec, and the UI (client-side pre-check). See ADR 0002 / ADR 0003.
 */

/** Hard size cap — the Workers Free request-body limit. Above this we 413 before reading. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Human-readable form of MAX_UPLOAD_BYTES for error messages and UI hints. */
export const MAX_UPLOAD_LABEL = "100 MB";

/**
 * Wall-clock budget for parsing one upload once its bytes are in memory. Parsing even a
 * 100 MB file is single-digit milliseconds, so this only trips on a pathological/runaway
 * stream — we return 503 instead of spinning. It is a graceful backstop, NOT a substitute
 * for the platform CPU limit (Workers Free hard-terminates at 10 ms CPU, which cannot be
 * caught in-isolate); the embeddable library is the hatch for files too large to count
 * server-side. See ADR 0003.
 */
export const PROCESSING_BUDGET_MS = 5_000;
