<script lang="ts">
import { AudioLines, BookOpen, Clock, FileAudio, Gauge, Pause, Play, Radio, Shield, TriangleAlert, Upload, Waves } from "@lucide/svelte";
import { cubicOut } from "svelte/easing";
import { Tween } from "svelte/motion";
import { fade, slide } from "svelte/transition";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../../src/lib/limits";
import type { FrameAnalysis } from "../../src/lib/mp3/analyze";

let file = $state<File | null>(null);
let dragging = $state(false);
let loading = $state(false);
let uploadProgress = $state(0);
let flash = $state(false);
let result = $state<FrameAnalysis | null>(null);
let error = $state<string | null>(null);

// Audio player state.
let audio = $state<HTMLAudioElement | null>(null);
let audioUrl = $state<string | null>(null);
let isPlaying = $state(false);
let currentTime = $state(0);
let audioDuration = $state(0);
let audioError = $state<string | null>(null);
let rafId = $state<number | null>(null);

// The size cap is locally knowable, so reject oversize files before any upload.
const tooBig = $derived(file !== null && file.size > MAX_UPLOAD_BYTES);

// Flash the drop zone the moment the progress bar hits 100%.
$effect(() => {
  if (uploadProgress === 100) {
    flash = true;
    window.setTimeout(() => {
      flash = false;
    }, 420);
  }
});

// Revoke the old blob URL when a new one is created or the component unmounts.
$effect(() => {
  const url = audioUrl;
  return () => {
    if (url) URL.revokeObjectURL(url);
  };
});

const frameTween = new Tween(0, { duration: 650, easing: cubicOut });

function resetAudio() {
  stopRaf();
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  isPlaying = false;
  currentTime = 0;
  audioDuration = 0;
  audioError = null;
}

function startRaf() {
  if (rafId !== null) return;
  function tick() {
    if (audio) {
      currentTime = audio.currentTime;
    }
    if (isPlaying) {
      rafId = requestAnimationFrame(tick);
    }
  }
  rafId = requestAnimationFrame(tick);
}

function stopRaf() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function togglePlay() {
  if (!audio) return;
  if (isPlaying) {
    audio.pause();
  } else {
    audio.play().catch(() => {
      audioError = "This file can’t be previewed.";
    });
  }
}

function setupAudio(f: File) {
  resetAudio();
  const url = URL.createObjectURL(f);
  audioUrl = url;
  const a = new Audio(url);
  a.preload = "metadata";

  a.addEventListener("play", () => {
    isPlaying = true;
    startRaf();
  });
  a.addEventListener("pause", () => {
    isPlaying = false;
    stopRaf();
    if (audio) currentTime = audio.currentTime;
  });
  a.addEventListener("ended", () => {
    isPlaying = false;
    stopRaf();
    currentTime = 0;
  });
  a.addEventListener("seeked", () => {
    if (audio) currentTime = audio.currentTime;
  });
  a.addEventListener("loadedmetadata", () => {
    if (audio) audioDuration = audio.duration || 0;
  });
  a.addEventListener("error", () => {
    audioError = "This file can’t be previewed.";
  });

  audio = a;
}

const playbackFrame = $derived.by(() => {
  if (!result) return 0;
  const frame = Math.floor((currentTime * result.sampleRate) / 1152);
  return Math.max(0, Math.min(frame, result.frameCount));
});

function pick(f: File | null | undefined) {
  file = f ?? null;
  result = null;
  error = null;
  resetAudio();
}

async function analyze() {
  if (!file || loading || tooBig) return;
  loading = true;
  uploadProgress = 0;
  error = null;
  result = null;
  frameTween.set(0, { duration: 0 }); // reset so the count-up starts from zero
  try {
    const form = new FormData();
    form.set("file", file);
    const { status, body } = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          uploadProgress = Math.round((e.loaded / e.total) * 100);
        }
      });
      xhr.addEventListener("load", () => {
        uploadProgress = 100;
        let parsed: unknown;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = null;
        }
        resolve({ status: xhr.status, body: parsed });
      });
      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
      xhr.open("POST", "/file-upload");
      xhr.send(form);
    });
    if (status >= 200 && status < 300) {
      result = body as FrameAnalysis;
      frameTween.set(result.frameCount); // animate the count up to the result
      if (file) setupAudio(file);
    } else {
      const detail = body as { error?: { message?: string } };
      error = detail.error?.message ?? `Request failed (${status})`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Network error";
  } finally {
    loading = false;
    // Let the progress bar stay at 100% while the flash plays, then fade out.
    window.setTimeout(() => {
      uploadProgress = 0;
    }, 550);
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const bitrateLabel = $derived.by(() => {
  if (!result) return "";
  return result.bitrate.mode === "cbr"
    ? `${result.bitrate.kbps} kbps · CBR`
    : `${result.bitrate.averageKbps} kbps · VBR`;
});
</script>

{#snippet stat(Icon: typeof Clock, label: string, value: string)}
  <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
    <Icon size={16} class="shrink-0 text-muted-foreground" />
    <div class="min-w-0">
      <div class="text-xs text-muted-foreground">{label}</div>
      <div class="truncate font-medium">{value}</div>
    </div>
  </div>
{/snippet}

<main class="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
  <div class="w-full max-w-xl space-y-6">
    <header class="space-y-2 text-center">
      <div class="inline-flex items-center gap-2 text-muted-foreground">
        <AudioLines size={18} />
        <span class="text-xs font-medium uppercase tracking-widest">MPEG-1 Layer III</span>
      </div>
      <h1 class="text-3xl font-semibold tracking-tight">MP3 Frame Analysis</h1>
      <p class="text-sm text-muted-foreground">Upload an MP3 to count its audio frames.</p>
    </header>

    <div class="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
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
          pick(e.dataTransfer?.files?.[0]);
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
          onchange={(e) => pick(e.currentTarget.files?.[0])}
        />
      </label>

      <button
        type="button"
        class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        disabled={!file || loading || tooBig}
        onclick={analyze}
      >
        {#if loading}
          <span class="animate-pulse">Uploading…</span>
        {:else}
          <Gauge size={16} /> Analyze
        {/if}
      </button>

      {#if error}
        <div
          class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          transition:fade={{ duration: 150 }}
        >
          <TriangleAlert size={16} class="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      {/if}

      {#if result}
        <div class="space-y-4" transition:slide={{ duration: 350, easing: cubicOut }}>
          <div class="rounded-lg bg-muted/40 p-5 text-center">
            <div class="text-xs uppercase tracking-widest text-muted-foreground">Frame count</div>
            <div class="text-5xl font-semibold tabular-nums">
              {Math.round(frameTween.current).toLocaleString()}
            </div>
            <div class="text-xs text-muted-foreground">
              {result.framesIncludingHeader.toLocaleString()} including the header frame
            </div>
          </div>

          <!-- Player: consolidated play controls, playback frame, and elapsed duration. -->
          <div class="rounded-lg border border-border bg-muted/20 p-4">
            <div class="flex items-center gap-4">
              <button
                type="button"
                onclick={togglePlay}
                disabled={!!audioError || !audio}
                class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {#if isPlaying}
                  <Pause size={18} />
                {:else}
                  <Play size={18} />
                {/if}
              </button>

              <input
                type="range"
                min={0}
                max={audioDuration || 1}
                step={0.001}
                value={currentTime}
                disabled={!!audioError || !audio}
                oninput={(e) => {
                  if (!audio) return;
                  const t = Number(e.currentTarget.value);
                  audio.currentTime = t;
                  currentTime = t;
                }}
                class="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
              />

              <div class="min-w-[7rem] shrink-0 text-right text-sm">
                <div class="font-medium tabular-nums">
                  Frame {playbackFrame.toLocaleString()} / {result.frameCount.toLocaleString()}
                </div>
                <div class="text-xs tabular-nums text-muted-foreground">
                  {formatDuration(currentTime)}
                </div>
              </div>
            </div>
            {#if audioError}
              <div class="mt-2 text-xs text-destructive" transition:fade={{ duration: 150 }}>
                {audioError}
              </div>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            {@render stat(Clock, "Duration", formatDuration(result.durationSeconds))}
            {@render stat(Gauge, "Bitrate", bitrateLabel)}
            {@render stat(Radio, "Channels", result.channelMode.replace(/_/g, " "))}
            {@render stat(Waves, "Sample rate", `${result.sampleRate / 1000} kHz`)}
          </div>

          {#if result.flags.truncated || result.flags.corrupt}
            <div class="flex flex-wrap gap-2 text-xs">
              {#if result.flags.truncated}
                <span class="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                  truncated final frame
                </span>
              {/if}
              {#if result.flags.corrupt}
                <span class="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                  corrupt stream · resynced
                </span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <footer class="flex flex-col items-center gap-2 text-xs text-muted-foreground">
      <div class="flex items-center gap-4">
        <a
          href="/docs"
          class="inline-flex items-center gap-1.5 underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          <BookOpen size={14} /> API docs
        </a>
        <a
          href="/privacy"
          class="inline-flex items-center gap-1.5 underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          <Shield size={14} /> Privacy
        </a>
      </div>
      <a
        href="https://mekyle.com"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
      >
        <img src="/mekyle.png" alt="" width="14" height="14" class="rounded-sm" />
        Built by mekyle.com
      </a>
    </footer>
  </div>
</main>

<style>
  /* Subtle fill behind the progressing edge. */
  .progress-fill {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.08);
  }

  /* Glittering stars concentrated at the right edge of the progress line,
     fading from bright at the edge to transparent further left.
     The strip is translated via transform (GPU-composited) to keep CPU usage low. */
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

  /* Smooth width updates while uploading; opacity fade once loading finishes. */
  .progress-bar {
    transition: width 0.1s linear, opacity 0.45s ease-out;
  }
  .progress-bar-fade {
    opacity: 0;
  }

  /* Brief white flash over the drop zone at 100%. */
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
