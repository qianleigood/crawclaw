---
name: gif-sticker-maker
description: Convert photos into four animated GIF stickers with captions. Use when the user wants cartoon stickers, animated avatars, emoji packs, or short Funko/Pop-Mart-style reaction GIFs from a source image.
license: MIT
metadata:
  version: "1.2"
  category: creative-tools
---

# GIF Sticker Maker

Use this skill to turn a source image into a small pack of animated reaction GIFs.

## Default workflow

1. Confirm captions or use defaults from the caption table.
2. Generate four static sticker images from the source.
3. Animate each sticker image into video.
4. Convert the videos into GIFs.
5. Deliver only real generated assets.

## Working rules

- Keep all captions in one language.
- Use English image/video prompts even if the user speaks another language.
- Do not skip prerequisites: env, API key, and `ffmpeg`.
- `<deliver_assets>` must remain the last response block when used.

## Read references as needed

- `references/captions.md`
  For multilingual caption defaults.
- `references/requirements.txt`
  For environment expectations.
- `assets/image-prompt-template.txt`
- `assets/video-prompt-template.txt`
