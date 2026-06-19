<script lang="ts">
import { AudioLines, BookOpen, Clock, Gauge, Radio, Shield, TriangleAlert, Waves } from "@lucide/svelte";
import { cubicOut } from "svelte/easing";
import { Tween } from "svelte/motion";
import { fade, slide } from "svelte/transition";
import { MAX_UPLOAD_BYTES } from "../../src/lib/limits";
import type { FrameAnalysis } from "../../src/lib/mp3/analyze";
import AudioPlayer from "./components/AudioPlayer.svelte";
import UploadDropzone from "./components/UploadDropzone.svelte";
import { uploadFile, type UploadErrorBody } from "./lib/upload";

let file = $state<File | null>(null);
let loading = $state(false);
let uploadProgress = $state(0);
let result = $state<FrameAnalysis | null>(null);
let error = $state<string | null>(null);

const tooBig = $derived(file !== null && file.size > MAX_UPLOAD_BYTES);
const frameTween = new Tween(0, { duration: 650, easing: cubicOut });

function pick(f: File | null | undefined) {
  file = f ?? null;
  result = null;
  error = null;
}

async function analyze() {
  if (!file || loading || tooBig) return;
  loading = true;
  uploadProgress = 0;
  error = null;
  result = null;
  frameTween.set(0, { duration: 0 });

  const res = await uploadFile(file, (p) => {
    uploadProgress = p;
  });

  loading = false;
  if (!res.ok) {
    error = res.error;
  } else if (res.status >= 200 && res.status < 300) {
    result = res.body as FrameAnalysis;
    frameTween.set(result.frameCount);
  } else {
    const detail = res.body as UploadErrorBody;
    error = detail.error.message ?? `Request failed (${res.status})`;
  }

  window.setTimeout(() => {
    uploadProgress = 0;
  }, 550);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
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
      <UploadDropzone
        {file}
        {loading}
        {uploadProgress}
        {tooBig}
        onPick={pick}
        onAnalyze={analyze}
      />

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

          {#if file}
            <AudioPlayer {file} {result} />
          {/if}

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
