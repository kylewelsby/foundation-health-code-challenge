<script lang="ts">
import { Pause, Play } from "@lucide/svelte";
import type { FrameAnalysis } from "../../../src/lib/mp3/analyze";

type Props = {
  file: File;
  result: FrameAnalysis;
};

let { file, result }: Props = $props();

let audio = $state<HTMLAudioElement | null>(null);
let isPlaying = $state(false);
let currentTime = $state(0);
let audioDuration = $state(0);
let audioError = $state<string | null>(null);
let rafId = $state<number | null>(null);

$effect(() => {
  const url = URL.createObjectURL(file);
  const a = new Audio(url);
  a.preload = "metadata";

  function onPlay() {
    isPlaying = true;
    startRaf();
  }
  function onPause() {
    isPlaying = false;
    stopRaf();
    currentTime = a.currentTime;
  }
  function onEnded() {
    isPlaying = false;
    stopRaf();
    a.currentTime = 0;
    currentTime = 0;
  }
  function onSeeked() {
    currentTime = a.currentTime;
  }
  function onLoadedMetadata() {
    audioDuration = a.duration || 0;
  }
  function onError() {
    audioError = "This file can’t be previewed.";
  }

  a.addEventListener("play", onPlay);
  a.addEventListener("pause", onPause);
  a.addEventListener("ended", onEnded);
  a.addEventListener("seeked", onSeeked);
  a.addEventListener("loadedmetadata", onLoadedMetadata);
  a.addEventListener("error", onError);

  audio = a;

  return () => {
    stopRaf();
    a.pause();
    a.src = "";
    a.removeEventListener("play", onPlay);
    a.removeEventListener("pause", onPause);
    a.removeEventListener("ended", onEnded);
    a.removeEventListener("seeked", onSeeked);
    a.removeEventListener("loadedmetadata", onLoadedMetadata);
    a.removeEventListener("error", onError);
    URL.revokeObjectURL(url);
  };
});

function startRaf() {
  if (rafId !== null) return;
  function tick() {
    if (audio) currentTime = audio.currentTime;
    if (isPlaying) rafId = requestAnimationFrame(tick);
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

function onScrub(e: Event & { currentTarget: HTMLInputElement }) {
  if (!audio) return;
  const t = Number(e.currentTarget.value);
  audio.currentTime = t;
  currentTime = t;
}

const playbackFrame = $derived.by(() => {
  const frame = Math.floor((currentTime * result.sampleRate) / 1152);
  return Math.max(0, Math.min(frame, result.frameCount));
});

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}
</script>

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
      oninput={onScrub}
      class="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed"
    />

    <div class="min-w-[7rem] shrink-0 text-right text-sm">
      <div class="font-medium tabular-nums">
        Frame {playbackFrame.toLocaleString()} / {result.frameCount.toLocaleString()}
      </div>
      <div class="text-xs tabular-nums text-muted-foreground">{formatDuration(currentTime)}</div>
    </div>
  </div>

  {#if audioError}
    <div class="mt-2 text-xs text-destructive">{audioError}</div>
  {/if}
</div>
