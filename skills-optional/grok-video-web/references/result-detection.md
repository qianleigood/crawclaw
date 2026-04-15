# Grok Video Web Result Detection

## Stronger completion heuristics

Treat the following as strong completion signals on a Grok result page:

- `下载`
- `创建共享链接`
- stable result URL like `/imagine/post/<id>`
- a playable completed video element
- follow-up action such as `生成视频`

Completion should be based on strong page evidence, not on submit having happened earlier.

## Progress heuristics

Keep the job in a non-complete state when only progress-style cues are visible, such as:

- queue or rendering text
- processing indicators
- pending-only UI
- incomplete video element state without strong completion actions

Typical external status remains `queued` or `generating` in these cases.

## Blocker heuristics

Treat the page as blocked when strong blocker cues are visible, for example:

- login wall or auth redirect
- Cloudflare / Turnstile / human verification
- quota / paywall / subscription gate that prevents continued use
- redirect away from the expected result flow
- result page loads but video element is in an obvious error state

When blocker cues and success cues conflict, prefer honesty: record the conflict and stop rather than claiming success.

## Login-related result-page checks

Before waiting on or downloading from an account-gated result page:

- confirm login again from the safe Grok entry page
- only then open or reopen the target result page

Do not treat a failed result-page open as a generation failure if the true root cause is lost login state.

## Result URL consistency

Do not trust any visible URL blindly.

Prefer consistency checks based on:

- expected result URL
- expected post id
- observed URL
- observed post id

Typical outcomes:

- `matched`
- warning-level mismatch
- block-level mismatch

For derivative flows, a new post id should be different from the source post id before it is treated as a true new result.

## Download readiness

Only attempt download when the result page shows strong completion evidence.

If the direct download button is not visible:

- hover the video surface
- probe settings / more / `更多` menu paths
- inspect visible action labels before concluding the control is missing

If download UI still cannot be found, treat that as a blocker or page-drift issue, not a silent success.

## Delivery expectations

Do not stop at a bare local path unless channel delivery is unavailable or the user explicitly asked for path-only output.

When delivery succeeds, include:

- delivered artifact
- local export path
- result URL when useful for revisit or audit
