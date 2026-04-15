---
title: "Image Tool"
summary: "Analyze one or more images with the configured vision model"
read_when:
  - You want to analyze images from agents
  - You need exact image tool parameters and limits
  - You are debugging image model resolution or local path access
---

# Image tool

`image` analyzes one or more images and returns text.

Quick behavior:

- Supports single (`image`) or multi-image (`images`) input.
- Accepts local file paths, `file://` URLs, `data:` URLs, and `http(s)` URLs.
- Uses the configured image model, or best-effort provider defaults when possible.
- Returns text in `content[0].text` plus structured metadata in `details`.

## Availability

The tool is only registered when CrawClaw can resolve an image-capable model config for the agent:

1. `agents.defaults.imageModel`
2. fallback to a best-effort provider vision pairing based on the default model
3. fallback to OpenAI / Anthropic defaults when auth is available

If no usable model can be resolved, the `image` tool is not exposed.

<Note>
  If the current chat model already has native vision and the user attached
  images directly in the prompt, those images are already visible to the model.
  In that case, use `image` only when you need to load additional image paths or
  URLs that were not already part of the message.
</Note>

## Input reference

- `image` (`string`): one image path or URL
- `images` (`string[]`): multiple image paths or URLs, up to `maxImages`
- `prompt` (`string`): analysis prompt, default `Describe the image.`
- `model` (`string`): optional model override (`provider/model`)
- `maxBytesMb` (`number`): per-image size cap in MB
- `maxImages` (`number`): maximum images accepted in this call, default `20`

Input notes:

- `image` and `images` are merged and deduplicated before loading.
- If no image input is provided, the tool errors.
- If more than `maxImages` images are provided, the tool returns a structured
  `too_many_images` error in `details`.

## Supported image references

- local file path (including `~` expansion)
- workspace-relative local path
- `file://` URL
- `data:` URL
- `http://` and `https://` URL

Reference notes:

- Unsupported URI schemes are rejected with `unsupported_image_reference`.
- In sandbox mode, remote `http(s)` URLs are rejected.
- With workspace-only file policy enabled, local file paths outside allowed
  roots are rejected.

## Model routing

CrawClaw resolves an image-capable model first, then runs the request through
the matching media-understanding provider.

Provider notes:

- Multi-image input uses provider-native multi-image support when available.
- Otherwise CrawClaw falls back to sequential per-image descriptions.
- MiniMax vision models are routed through the MiniMax VLM path automatically.

## Config

```json5
{
  agents: {
    defaults: {
      imageModel: {
        primary: "openai/gpt-5-mini",
        fallbacks: ["anthropic/claude-opus-4-5"],
      },
      mediaMaxMb: 10,
    },
  },
}
```

See [Configuration Reference](/gateway/configuration-reference) for full field details.

## Output details

The tool returns text in `content[0].text` and structured metadata in `details`.

Common `details` fields:

- `model`: resolved model ref (`provider/model`)
- `attempts`: fallback attempts that failed before success

Path fields:

- single image input: `details.image`
- multiple image inputs: `details.images[]` with `image` entries
- sandbox path rewrite metadata (when applicable): `rewrittenFrom`

## Error behavior

- Missing image input: throws `image required`
- Too many images: returns structured error in `details.error = "too_many_images"`
- Unsupported reference scheme: returns `details.error = "unsupported_image_reference"`
- Sandboxed remote URL: throws `Sandboxed image tool does not allow remote URLs.`

## Examples

Single image:

```json
{
  "image": "/tmp/photo.jpg",
  "prompt": "Describe the scene and any visible text"
}
```

Multiple images:

```json
{
  "images": ["/tmp/frame-1.png", "/tmp/frame-2.png"],
  "prompt": "Compare these screenshots and list the UI differences"
}
```

Remote image:

```json
{
  "image": "https://example.com/chart.png",
  "prompt": "Summarize the chart in three bullets"
}
```

## Related

- [Tools Overview](/tools) — all available agent tools
- [PDF Tool](/tools/pdf) — analyze PDF files with native and fallback paths
