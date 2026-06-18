# MP3 Frame Analysis

A tool that accepts an MP3 upload and counts the MPEG-1 Audio Layer III frames in it.

## Language

**Frame**:
A single MPEG-1 Audio Layer III audio frame — a 4-byte header (sync word plus
encoded fields) followed by its audio payload.
_Avoid_: packet, chunk, block

**Frame count**:
The audio Frames in the file — the value returned to the caller. **Excludes** the
Header frame. Matches ffprobe consistently (CBR and VBR), the Declared frame count,
and mediainfo on the provided VBR sample (6089). This is the number the spec's own
`mediainfo` verification step reports, so it is the number we return.
_Avoid_: frame total, sample count (a frame is 1152 samples, not one sample)

**Header frame**:
The first Frame in the file when it carries a Xing, Info, or VBRI metadata block.
A structurally complete Frame (valid sync word, bitrate, sample rate) whose payload
is metadata rather than audio. **Not** counted in Frame count — it carries no audio.
_Avoid_: Xing frame (use only when specifically meaning the Xing variant)

**Structural frame total**:
Every valid Frame including the Header frame (`Frame count + 1` when a Header frame
is present). Exposed in metadata as `framesIncludingHeader` for transparency; never
the value of `frameCount`. mediainfo reports this number for CBR/Info files (an
idiosyncrasy — it computes from file size); we follow ffprobe and exclude it.
_Avoid_: raw count, walked count

**Truncated frame**:
A final Frame whose header is valid but whose payload is cut off by end-of-input
(fewer than `frameLength` bytes remain). Not counted; surfaced as `truncated: true`.
Distinct from a Corrupt stream — truncation is benign (e.g. a partial download).
_Avoid_: broken frame, partial frame

**Duration**:
The decoded-sample length reported for display: `frames × 1152 / sampleRate`,
in fractional seconds (ms precision, never whole-second rounded). Approximate —
runs ~tens of ms longer than Gapless duration. Returned as `durationSeconds`.
_Avoid_: length, runtime

**Gapless duration**:
The sample-exact playback length, with encoder delay and padding (from the LAME
tag) removed — what ffmpeg reports. A media-player concern (seamless track
concatenation), out of scope for this analyzer unless cheaply derivable from an
existing LAME tag.
_Avoid_: true duration (it is *a* true duration, just a different one)

**Free-format**:
A Frame with bitrate index `0000` — a constant bitrate not in the standard table,
derivable only by measuring the distance to the next sync. Rejected (HTTP 400,
named): the `144·bitrate/sr` formula has no table bitrate, and a computed
`frameLength` of 0 would stall the walk. ffmpeg itself refuses these files.
_Avoid_: variable bitrate (that is VBR, unrelated)

**Corrupt stream**:
A file that contains at least one valid Frame but then hits unrecoverable garbage
(resync fails within bounds). The Frame count so far is still returned, flagged
`corrupt: true` (HTTP 200). Distinct from a non-MP3, which has zero valid Frames
and is rejected (HTTP 400), and from a Truncated frame, which is benign.
_Avoid_: invalid file, broken file

**Declared frame count**:
The frame total written *inside* a Xing/Info/VBRI Header frame. By LAME convention
it excludes the Header frame, so it **equals** Frame count. Used as a test oracle
alongside ffprobe and mediainfo; never returned to the caller.
_Avoid_: Xing count
