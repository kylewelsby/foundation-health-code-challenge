/** Error shape returned by POST /file-upload on 4xx/5xx responses. */
export type UploadErrorBody = { error: { code: string; message: string } };

/** Result of uploading a file to POST /file-upload via XMLHttpRequest. */
export type UploadResult =
  | { readonly ok: true; readonly status: number; readonly body: object | null }
  | { readonly ok: false; readonly error: string };

/**
 * Upload `file` to `/file-upload` and report progress via `onProgress` (0–100).
 * Returns the HTTP status and parsed JSON body, or a network/abort error string.
 */
export function uploadFile(file: File, onProgress: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      onProgress(100);
      let parsed: object | null = null;
      try {
        const value = JSON.parse(xhr.responseText);
        parsed = value !== null && typeof value === "object" ? value : null;
      } catch {
        parsed = null;
      }
      resolve({ ok: true, status: xhr.status, body: parsed });
    });

    xhr.addEventListener("error", () => resolve({ ok: false, error: "Network error" }));
    xhr.addEventListener("abort", () => resolve({ ok: false, error: "Upload cancelled" }));

    xhr.open("POST", "/file-upload");
    const form = new FormData();
    form.set("file", file);
    xhr.send(form);
  });
}
