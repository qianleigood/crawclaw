# API reference

Base URL defaults to:

```text
http://localhost:3001
```

## Health / quota

### `GET /api/get_limit`

Returns current quota information.

Use this as the first health check after deployment.

## Generation

### `POST /api/generate`

Minimal body:

```json
{
  "prompt": "电子氛围，女声，空灵",
  "make_instrumental": false,
  "wait_audio": false
}
```

Fields seen in upstream route:

- `prompt`
- `make_instrumental`
- `model`
- `wait_audio`

Returns an array of generated clip objects.

Wrapper extras available in `scripts/suno_api.py` for this endpoint:

- `--only-gen`
- `--include-page-url`
- `--download-dir <dir>` (works when `audio_url` is already available, typically with `--wait-audio` or later polling)
- `--fields <comma-separated-fields>`
- `--wait-audio-timeout <seconds>`

### `POST /api/custom_generate`

Body:

```json
{
  "prompt": "夜晚城市",
  "tags": "synthwave, female vocals",
  "title": "Midnight Run",
  "make_instrumental": false,
  "wait_audio": false,
  "negative_tags": "lofi"
}
```

Fields seen in upstream route:

- `prompt`
- `tags`
- `title`
- `make_instrumental`
- `model`
- `wait_audio`
- `negative_tags`

### `POST /api/generate_lyrics`

Body:

```json
{
  "prompt": "写一首关于春天和重启的歌"
}
```

## Query results

### `GET /api/get?ids=<id1,id2>`

Returns song info for one or more ids.

If no ids are supplied, upstream returns a feed/list.

Use this for polling until generated songs are ready.

Wrapper extras available in `scripts/suno_api.py` for this endpoint:

- `--only-gen`
- `--include-page-url`
- `--download-dir <dir>`
- `--fields <comma-separated-fields>`

### `GET /api/clip?id=<clip_id>`

Returns clip information for one clip id.

### `GET /api/persona?id=<persona_id>&page=<page>`

Returns persona information and clips.

## Editing / continuation

### `POST /api/extend_audio`

Body:

```json
{
  "audio_id": "<song id>",
  "prompt": "继续副歌",
  "continue_at": 115,
  "tags": "synthwave",
  "negative_tags": "noisy",
  "title": "Extended Version",
  "wait_audio": false
}
```

Required field in upstream route:

- `audio_id`

Optional fields seen in upstream route:

- `prompt`
- `continue_at`
- `tags`
- `negative_tags`
- `title`
- `model`
- `wait_audio`

### `POST /api/concat`

Body:

```json
{
  "clip_id": "<clip id>"
}
```

### `POST /api/generate_stems`

Body:

```json
{
  "audio_id": "<song id>"
}
```

### `GET /api/get_aligned_lyrics?id=<song_id>`

Returns word-level lyric timing.

## OpenAI-compatible adapter

### `POST /v1/chat/completions`

The upstream repo includes a compatibility route, but it is a thin custom adapter rather than a full OpenAI implementation.

Use it only when the user explicitly wants the OpenAI-style surface.
For direct control, prefer the native `/api/*` endpoints.

## Cookie override

The upstream README states request `Cookie` headers can override the service default `SUNO_COOKIE`.
Use this only when the user explicitly needs per-request account switching.
