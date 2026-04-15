---
name: video-clip-skill
description: Clip online videos locally with `yt-dlp`, `ffmpeg`, and the bundled ASS subtitle helper. Use when the user wants highlight clipping, subtitle burn-in, bilingual subtitle generation, or short-form video extraction from a URL or downloaded media. Prefer this skill for local clipping workflows instead of remote editors.
---

# Clip Local

Use this skill for local video clipping, not for publishing or remote editing.

## Core workflow

1. Verify tools first:
   - `yt-dlp`
   - `ffmpeg`
   - `python3`
2. Decide the mode:
   - explicit start/end times -> clip directly
   - no times -> identify 3-5 highlight candidates, then ask the user which segment to keep
3. Prefer source subtitles when available:
   - detect original language
   - download original subtitles
   - trim subtitle cues to the selected clip range
4. Only fall back to transcription when needed:
   - if no subtitles exist and `GROQ_API_KEY` is present, run Whisper fallback
   - otherwise ask whether to continue without subtitles
5. Burn subtitles only when requested:
   - plain clipping -> prefer stream copy when safe
   - karaoke / bilingual output -> use the bundled ASS helper and re-encode intentionally

## Execution notes

- The bundled subtitle helper lives at `scripts/ass-karaoke.py`.
- Keep absolute timestamps in the trimmed VTT; shift relative to clip start with the helper's offset flag.
- Re-resolve media URLs if the clip step fails after a long delay because signed stream URLs expire.

## Reference routing

- Read `scripts/ass-karaoke.py` when you need exact subtitle rendering behavior.
- Read nearby runtime files only if you need to debug clipping, subtitle timing, or fallback transcription.

## Working rules

- Do not use auto-translated YouTube subtitles as the primary source.
- Confirm highlights with the user before clipping when they did not specify timestamps.
- Keep clipping local; do not route this skill into external publishing flows.
- Explain when subtitle burn-in forces re-encoding and longer runtime.
