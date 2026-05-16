---
summary: "Deepgram transcription for inbound voice notes"
read_when:
  - You want Deepgram speech-to-text for audio attachments
  - You need a quick Deepgram config example
title: "Deepgram"
---

# Deepgram (Audio Transcription)

Deepgram is a speech-to-text API. CrawClaw's old TypeScript
media-understanding provider path has been removed, so Deepgram transcription is
not exposed until it lands in the Rust-native media-understanding runtime.

Website: [https://deepgram.com](https://deepgram.com)  
Docs: [https://developers.deepgram.com](https://developers.deepgram.com)

## Status

Do not configure Deepgram through TypeScript plugin media-understanding
providers. The next supported route is Rust-native.

## Options

- Rust-native implementation is required before `tools.media.audio` can route to
  Deepgram again.

## Notes

- `DEEPGRAM_API_KEY` remains the expected secret name for the future
  Rust-native implementation.
