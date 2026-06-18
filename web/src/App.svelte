<script lang="ts">
import { AudioLines, BookOpen, Clock, FileAudio, Gauge, Radio, Shield, TriangleAlert, Upload, Waves } from "@lucide/svelte";
import { cubicOut } from "svelte/easing";
import { Tween } from "svelte/motion";
import { fade, slide } from "svelte/transition";

type Bitrate = { mode: "cbr"; kbps: number } | { mode: "vbr"; averageKbps: number; nominalKbps?: number };
type Analysis = {
  frameCount: number;
  framesIncludingHeader: number;
  durationSeconds: number;
  sampleRate: number;
  channelMode: string;
  bitrate: Bitrate;
  header: { kind: string; declaredFrameCount?: number };
  flags: { truncated: boolean; corrupt: boolean };
};

let file = $state<File | null>(null);
let dragging = $state(false);
let loading = $state(false);
let result = $state<Analysis | null>(null);
let error = $state<string | null>(null);

const frameTween = new Tween(0, { duration: 650, easing: cubicOut });

function pick(f: File | null | undefined) {
  file = f ?? null;
  result = null;
  error = null;
}

async function analyze() {
  if (!file || loading) return;
  loading = true;
  error = null;
  result = null;
  frameTween.set(0, { duration: 0 }); // reset so the count-up starts from zero
  try {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/file-upload", { method: "POST", body: form });
    const body: unknown = await res.json();
    if (res.ok) {
      result = body as Analysis;
      frameTween.set(result.frameCount); // animate the count up to the result
    } else {
      const detail = body as { error?: { message?: string } };
      error = detail.error?.message ?? `Request failed (${res.status})`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Network error";
  } finally {
    loading = false;
  }
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
      <label
        class="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors {dragging
          ? 'border-ring bg-muted/40'
          : 'border-border hover:bg-muted/30'}"
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
        <Upload size={28} class="text-muted-foreground" />
        {#if file}
          <span class="flex items-center gap-2 text-sm font-medium"><FileAudio size={16} /> {file.name}</span>
          <span class="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        {:else}
          <span class="text-sm font-medium">Drop an MP3 here, or click to browse</span>
          <span class="text-xs text-muted-foreground">max 25 MB</span>
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
        disabled={!file || loading}
        onclick={analyze}
      >
        {#if loading}
          <span class="animate-pulse">Analyzing…</span>
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
