<script lang="ts">
import { FileAudio, Gauge, TriangleAlert, Upload } from "@lucide/svelte";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../../src/lib/limits";

type Props = {
  file: File | null;
  loading: boolean;
  uploadProgress: number;
  tooBig: boolean;
  onPick: (file: File | null) => void;
  onAnalyze: () => void;
};

let { file, loading, uploadProgress, tooBig, onPick, onAnalyze }: Props = $props();

let dragging = $state(false);
let flash = $state(false);

$effect(() => {
  if (uploadProgress === 100) {
    flash = true;
    window.setTimeout(() => {
      flash = false;
    }, 420);
  }
});

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
</script>

<div class="space-y-5">
  <label
    class="relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors {tooBig
      ? 'border-destructive/50 bg-destructive/5'
      : dragging
        ? 'border-ring bg-muted/40'
        : 'border-border hover:bg-muted/30'} {flash ? 'flash-active' : ''}"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = false;
      onPick(e.dataTransfer?.files?.[0] ?? null);
    }}
  >
    {#if loading || uploadProgress > 0}
      <div
        class="progress-bar pointer-events-none absolute inset-y-0 left-0 overflow-hidden {loading ? '' : 'progress-bar-fade'}"
        style="width: {uploadProgress}%"
      >
        <div class="progress-fill"></div>
        <div class="sparkle-edge" aria-hidden="true">
          <div class="sparkle-strip"></div>
        </div>
      </div>
    {/if}
    <div class="flash-overlay" aria-hidden="true"></div>

    <Upload size={28} class={tooBig ? "text-destructive" : "text-muted-foreground"} />
    {#if file}
      <span class="flex items-center gap-2 text-sm font-medium"><FileAudio size={16} /> {file.name}</span>
      {#if tooBig}
        <span class="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert size={13} /> {formatSize(file.size)} — over the {MAX_UPLOAD_LABEL} limit
        </span>
      {:else}
        <span class="text-xs text-muted-foreground">{formatSize(file.size)}</span>
      {/if}
    {:else}
      <span class="text-sm font-medium">Drop an MP3 here, or click to browse</span>
      <span class="text-xs text-muted-foreground">max {MAX_UPLOAD_LABEL}</span>
    {/if}
    <input
      type="file"
      accept="audio/mpeg,.mp3"
      class="hidden"
      onchange={(e) => onPick(e.currentTarget.files?.[0] ?? null)}
    />
  </label>

  <button
    type="button"
    class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
    disabled={!file || loading || tooBig}
    onclick={onAnalyze}
  >
    {#if loading}
      <span class="animate-pulse">Uploading…</span>
    {:else}
      <Gauge size={16} /> Analyze
    {/if}
  </button>
</div>

<style>
  .progress-fill {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.08);
  }

  .sparkle-edge {
    position: absolute;
    inset: 0;
    mask-image: linear-gradient(to left, black 0%, black 18%, transparent 55%);
    -webkit-mask-image: linear-gradient(to left, black 0%, black 18%, transparent 55%);
    overflow: hidden;
  }
  .sparkle-strip {
    position: absolute;
    inset: 0;
    width: 200%;
    will-change: transform;
    background-image:
      radial-gradient(1.5px 1.5px at 12px 8px, rgba(255, 255, 255, 0.95), transparent),
      radial-gradient(1px 1px at 26px 20px, rgba(255, 255, 255, 0.65), transparent),
      radial-gradient(2px 2px at 6px 24px, rgba(255, 255, 255, 0.8), transparent),
      radial-gradient(1px 1px at 32px 6px, rgba(255, 255, 255, 0.55), transparent),
      radial-gradient(1.5px 1.5px at 18px 16px, rgba(255, 255, 255, 0.9), transparent);
    background-size: 36px 32px, 28px 26px, 22px 24px, 30px 28px, 26px 22px;
    background-position: 0 0, 8px 6px, 4px 14px, 14px 4px, 6px 8px;
    animation: sparkle-drift 0.55s linear infinite;
  }

  @keyframes sparkle-drift {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

  .progress-bar {
    transition: width 0.1s linear, opacity 0.45s ease-out;
  }
  .progress-bar-fade {
    opacity: 0;
  }

  .flash-overlay {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.35);
    opacity: 0;
    pointer-events: none;
  }
  .flash-active .flash-overlay {
    animation: flash-box 0.4s ease-out;
  }
  .flash-active {
    animation: flash-border 0.4s ease-out;
  }

  @keyframes flash-box {
    0% { opacity: 0; }
    30% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes flash-border {
    0% { box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0); }
    30% { box-shadow: inset 0 0 40px 4px rgba(255, 255, 255, 0.35); border-color: rgba(255, 255, 255, 0.85); }
    100% { box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0); }
  }
</style>
