---
summary: "Camera capture on paired node hosts for agent use: photos (jpg) and short video clips (mp4)"
read_when:
  - Adding or modifying camera capture on paired node hosts
  - Extending agent-accessible MEDIA temp-file workflows
title: "Camera Capture"
---

# Camera capture (agent)

CrawClaw currently supports **camera capture** for agent workflows through a
paired **node host**.

All camera access is gated behind **user-controlled settings**.

## Historical mobile node note

Archived mobile node clients exposed the same `camera.*` contract over `node.invoke`, but those source trees were removed from this repository.

## Node host

### User setting (default off)

The node host exposes a user-controlled camera setting:

- **Settings → General → Allow Camera** (`crawclaw.cameraEnabled`)
  - Default: **off**
  - When off: camera requests return “Camera disabled by user”.

### CLI helper (node invoke)

Use the main `crawclaw` CLI to invoke camera commands on a paired node.

Examples:

```bash
crawclaw nodes camera list --node <id>            # list camera ids
crawclaw nodes camera snap --node <id>            # prints MEDIA:<path>
crawclaw nodes camera snap --node <id> --max-width 1280
crawclaw nodes camera snap --node <id> --delay-ms 2000
crawclaw nodes camera snap --node <id> --device-id <id>
crawclaw nodes camera clip --node <id> --duration 10s          # prints MEDIA:<path>
crawclaw nodes camera clip --node <id> --duration-ms 3000      # prints MEDIA:<path> (legacy flag)
crawclaw nodes camera clip --node <id> --device-id <id>
crawclaw nodes camera clip --node <id> --no-audio
```

Notes:

- `crawclaw nodes camera snap` defaults to `maxWidth=1600` unless overridden.
- On macOS, `camera.snap` waits `delayMs` (default 2000ms) after warm-up/exposure settle before capturing.
- Photo payloads are recompressed to keep base64 under 5 MB.

## Safety + practical limits

- Camera and microphone access trigger the usual OS permission prompts (and require usage strings in Info.plist).
- Video clips are capped (currently `<= 60s`) to avoid oversized node payloads (base64 overhead + message limits).

## Screen video (OS-level)

For _screen_ video (not camera), use the paired node host:

```bash
crawclaw nodes screen record --node <id> --duration 10s --fps 15   # prints MEDIA:<path>
```

Notes:

- Requires macOS **Screen Recording** permission (TCC).
