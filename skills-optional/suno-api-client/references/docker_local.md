# Docker local deployment

## What the upstream repo does

The upstream `gcui-art/suno-api` project is a Next.js service that wraps Suno's unofficial web flow and exposes HTTP APIs.

For local Docker deployment, the important files are:

- `docker-compose.yml`
- `Dockerfile`
- `.env.example`

## Default compose behavior

The upstream `docker-compose.yml` runs one service:

```yaml
services:
  suno-api:
    build:
      context: .
      args:
        SUNO_COOKIE: ${SUNO_COOKIE}
    volumes:
      - ./public:/app/public
    ports:
      - "3000:3000"
    env_file: ".env"
```

That means:

- upstream container port is `3000`
- current host mapping on this machine is `3001 -> 3000`
- `.env` is loaded into the container
- `SUNO_COOKIE` is also passed as a build arg

## Required envs

Minimum useful envs:

```bash
SUNO_COOKIE=<real cookie>
TWOCAPTCHA_KEY=<real key>
BROWSER=chromium
BROWSER_GHOST_CURSOR=false
BROWSER_LOCALE=en
BROWSER_HEADLESS=true
```

## Recommended agent workflow

1. Clone repo
2. Copy `.env.example` to `.env`
3. Fill real credentials
4. Run:

```bash
docker compose build && docker compose up
```

5. Check:

```bash
curl http://localhost:3000/api/get_limit
```

## Common failure points

### `docker compose build` fails

Check:

- Docker daemon is running
- network access is available for npm / playwright downloads
- machine has enough disk space and memory

### Service starts but `/api/get_limit` fails

Check:

- `SUNO_COOKIE` is valid and not expired
- Suno account is usable in browser
- `TWOCAPTCHA_KEY` has balance
- container logs show captcha / browser errors

### Generation returns API or network errors

Check:

- local service is still healthy
- cookie has not expired
- 2Captcha balance is not exhausted
- browser config stays on `chromium`

### Generation returns `403 You don't have access to this model`

Treat this as a model drift / authorization mismatch first, not a generic network issue.

Check:

- whether the wrapper is sending an outdated `mv` / model value
- whether the browser's real request uses a different model than the server-side replay
- whether the browser flow succeeds while the replayed request fails

When needed, inspect the browser's real `/api/generate/v2-web/` request and compare:

- request body `mv`
- auth headers
- cookies
- extra metadata fields

Do not assume older model names remain valid forever; Suno changes these over time.

## Notes

- Upstream warns Docker disables GPU acceleration.
- Upstream recommends local deployment over Docker only when CPU is slow, but Docker is still valid for controlled local hosting.
- This is an unofficial wrapper, so upstream breakage is possible when Suno changes internals.
