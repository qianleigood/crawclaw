---
name: suno-api-client
description: Deploy and operate the unofficial gcui-art/suno-api service locally, then call its music-generation endpoints from scripts or agent workflows. Use when a user wants to self-host a Suno-compatible API with Docker, check quota/health, generate music or lyrics, poll song status, extend clips, or debug a local Suno wrapper.
---

# Suno API Client

Prefer local Docker deployment first.

## Confirm inputs

Confirm these before deployment:

- `SUNO_COOKIE`
- `TWOCAPTCHA_KEY`
- Optional but recommended:
  - `BROWSER=chromium`
  - `BROWSER_GHOST_CURSOR=false`
  - `BROWSER_LOCALE=en`
  - `BROWSER_HEADLESS=true`

Never invent or silently substitute the user's cookie or 2Captcha key.

## Deploy

1. Clone `gcui-art/suno-api`.
2. Copy `.env.example` to `.env`.
3. Fill the required envs.
4. Start the service with Docker Compose.
5. Verify health before debugging generation.

Typical flow:

```bash
git clone https://github.com/gcui-art/suno-api.git
cd suno-api
docker compose build && docker compose up
```

On this machine, the service is typically exposed at `http://localhost:3001`.

## Verify health

Check quota/health first:

```bash
curl http://localhost:3001/api/get_limit
```

If health fails, read `references/docker_local.md` before touching generation code.

## Call the API

Prefer `scripts/suno_api.py` over ad-hoc curl.

Examples:

```bash
python3 <skill_dir>/scripts/suno_api.py get-limit
python3 <skill_dir>/scripts/suno_api.py generate --prompt "电子氛围，女声，空灵" --wait-audio --only-gen --include-page-url
python3 <skill_dir>/scripts/suno_api.py custom-generate --prompt "夜晚城市" --tags "synthwave, female vocals" --title "Midnight Run" --download-dir /tmp/suno
python3 <skill_dir>/scripts/suno_api.py get --ids <id1,id2> --only-gen --include-page-url --download-dir /tmp/suno
python3 <skill_dir>/scripts/suno_api.py extend-audio --audio-id <id> --prompt "继续副歌" --continue-at 115
```

The wrapper defaults to `SUNO_API_BASE_URL=http://localhost:3001`.

Useful wrapper-only options:

- `--only-gen`: filter out preview/fenix candidates when mixed results are returned
- `--include-page-url`: append `https://suno.com/song/<id>` to each result item
- `--download-dir <dir>`: download returned `audio_url` files into a local directory when available
- `--fields id,status,audio_url,page_url`: keep only the fields needed by the next step
- `--wait-audio-timeout <seconds>`: override the HTTP timeout specifically for `--wait-audio` calls

## Generate and send workflow

When the user wants the generated result delivered back into the current chat:

1. Run `generate` or `get` with `--download-dir`.
2. Prefer `--only-gen` when preview results would add noise.
3. Use `--fields` only if the next step needs a compact manifest.
4. Send the downloaded file with the current channel's native file-send capability instead of pasting raw links.

This workflow lives at the agent/tool layer, not inside `scripts/suno_api.py` itself.

Use `--cookie "<cookie>"` only when the user explicitly wants per-request account switching.

## Smoke test

When the service is already running, verify both HTTP and CLI surfaces:

```bash
python3 <skill_dir>/tests/smoke_suno_api.py
python3 <skill_dir>/tests/smoke_suno_api.py --ids <id1,id2>
```

## Read references only when needed

- Read `references/docker_local.md` for Docker behavior, envs, and troubleshooting.
- Read `references/api_reference.md` for endpoint payloads and response shapes.

## Guardrails

- Treat this as an unofficial Suno wrapper.
- Verify health before debugging generation failures.
- Poll `/api/get` for async generation instead of assuming immediate success.
- Do not claim CAPTCHA solving is free; this stack expects 2Captcha / ruCaptcha.
