# Grok Video Web Page Observations

## Observed routing

- Home: `https://grok.com/`
- Imagine page: `https://grok.com/imagine`
- Result page pattern: `/imagine/post/<id>`

## Common UI observations

Observed controls on recent runs include:

- top nav entry such as `Imagine`
- auth links such as `登录`, `注册`
- prompt composer area
- attachment button / file input bridge
- submit button
- mode controls such as `图片`, `视频`
- video settings after video mode is active:
  - `480p`
  - `720p`
  - `6s`
  - `10s`
  - `宽高比`

Derivative result-page actions may appear as:

- `扩展视频`
- `延长视频`
- `Extend video`
- `Extend`
- `Redo`

On current stable Grok result pages, `Extend video` may live under the result-page `More options / ...` menu rather than as a direct visible button.
Once extend mode is opened, additive duration controls such as `+6s` and `+10s` may appear.

## Login-state cues

Prefer classifying login with multiple cues instead of one token alone.

### Stronger `logged_in` cues

- avatar/profile button
- nickname/account button
- signed-in sidebar entries such as `项目`, `历史记录`, `查看全部`
- account menu or logout/account settings style controls
- submit/download path works without redirecting to auth

### Stronger `not_logged_in` cues

- `登录` / `注册` is the dominant auth entry
- login modal or wall remains present
- submit/download redirects to auth
- sign-in form remains active after navigation

### `uncertain` cues

- quota/paywall/modal obscures state
- Cloudflare / Turnstile / human verification is visible
- logged-in and logged-out signals conflict
- neither signed-in nor signed-out markers are reliable

If cues conflict, treat the page as `uncertain` and stop rather than guessing.

## Reference-image mounted-state cues

Grok may consume the file input immediately after upload, so `input.files === 0` does **not** prove failure.

Prefer these signals for a successful mounted reference image:

- `img[src^="blob:https://grok.com/"]`
- nearby `button[aria-label="Remove image"]`
- optional stronger check: blob preview image dimensions match the uploaded local image
- submit button becomes usable after prompt + mounted reference image are both present

Stronger `mounted + usable` cues:

- the prompt box supports `@图片名` mention/reference behavior for the uploaded image
- the uploaded image can be explicitly inserted or referenced from the prompt UI, not just displayed as a blob preview

Treat `@图片名` style prompt-reference behavior as stronger than blob preview alone.

## Completion observations

Recent successful video generation produced these strong completion signals on the result page:

- `下载`
- `创建共享链接`
- stable result URL like `/imagine/post/<id>`
- playable completed video state
- follow-up action such as `生成视频`

If the page only shows pending/progress UI and none of the actions above, keep the state as `queued` or `generating`.

## Download UI observations

When direct download is not visible immediately, the action may be behind:

- a settings button
- a more button
- a localized `更多` menu

Hovering the video surface may reveal controls before probing menu paths.
On some result pages, clicking `Download` does not behave like a classic browser download button at the DOM level, but Chrome still records a real downloaded file. For those cases, prefer the real browser-download path and recover the file from the browser download side / download history rather than falling back to raw direct-fetch logic.
Some fresh-generate result pages have also been observed in a variant where the visible action area exposes `Redo` in the settings/menu path but does not immediately expose `Download`; treat that as a separate UI variant to probe honestly rather than assuming the extend/redo result-page download surface matches it.

## Maintenance checklist

If the skill stops working, check in this order:

1. Did Grok rename or move the `Imagine` entry?
2. Did `图片 / 视频` change from radios to tabs/buttons?
3. Did prompt composer refs change after selecting video mode?
4. Did submission move behind a modal or quota gate?
5. Did result/download controls rename or move into a context menu?
6. Did extend/redo entry points rename or move on the result page?
