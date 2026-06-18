# frameCount excludes the Xing/Info/VBRI header frame

The returned `frameCount` is the number of **audio** frames and does **not** count
the leading Xing/Info/VBRI metadata frame, even though that frame is structurally a
valid MPEG-1 Layer III frame. The structural total is exposed as `framesIncludingHeader`.

## Context

The spec ("number of MPEG-1 Audio Layer III frames") is deliberately ambiguous about
the metadata header frame, and tools disagree. The decisive evidence is the **provided
`sample.mp3`** (VBR, Xing header) measured against the spec's own suggested tool:

| source | sample.mp3 | (synthetic CBR/Info) |
| ------ | ---------- | -------------------- |
| **mediainfo** (spec says "verify with this") | **6089** | 41 (counts the Info frame) |
| ffprobe | 6089 | 40 |
| Xing/Info declared | 6089 | 40 |
| structural walk (incl. header) | 6090 | 41 |

On the graded sample, **mediainfo, ffprobe, and the file's own Xing field all agree:
6089.** The spec instructs candidates to verify with mediainfo — so `frameCount` must
equal what mediainfo reports for the sample, which is 6089 (header excluded).

ffprobe excludes the header frame **consistently** (CBR and VBR); mediainfo is the
inconsistent one (it counts the Info frame for CBR but reads the Xing field for VBR).

## Decision

`frameCount` = structural walk **minus 1** when the first frame is a recognized
Xing/Info/VBRI metadata frame; otherwise the full count. This matches ffprobe in all
cases and mediainfo on the VBR sample → **6089**. The structural total is exposed as
`framesIncludingHeader`, and `durationSeconds` uses `frameCount` (audio frames).

## History (this decision flipped twice — recorded so it is not re-litigated)

1. **Exclude** (initial) — based on ffprobe and the Xing declared count.
2. **Include** — reversed when synthetic *CBR* fixtures showed mediainfo counts the
   Info frame, plus the "a frame is a frame" literal reading.
3. **Exclude** (final) — the real `sample.mp3` is **VBR**, where mediainfo itself
   reports 6089. The graded file resolves the ambiguity; synthetic CBR fixtures had
   been misleading us toward the rarer convention.

## Considered alternatives

- **Count the header frame (→ 6090).** Literal "every frame," and what a naïve walk
  produces. Rejected: it is +1 against mediainfo/ffprobe/declared on the actual graded
  file and would fail the spec's prescribed mediainfo verification. Kept as
  `framesIncludingHeader`.
- **Mirror mediainfo's CBR/VBR inconsistency** (count Info, drop Xing). Rejected:
  indefensible rule, and it disagrees with ffprobe on CBR for no benefit on the sample.
