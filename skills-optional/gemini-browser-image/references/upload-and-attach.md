# Upload and Attach

Use this reference for Gemini image-guided jobs.

## Preferred path

Prefer this tested route before trying native fallbacks:
1. Return Gemini to a fresh or zero-state image flow.
2. Enter `制作图片`.
3. Open the upload menu.
4. Click `上传文件`.
5. Catch `filechooser` and call `setFiles()`.
6. Verify that Gemini truly attached the file before submitting.

Use `scripts/upload_via_xpath_and_open_panel.sh` for the mixed helper path.
It now prefers `filechooser -> setFiles()` and only falls back when chooser capture does not happen.

## Attachment success criteria

Do not treat upload as successful just because the menu click worked.
Use the stricter ready signal:
- preview is visible
- remove button is visible
- send button reports `aria-disabled="false"`

Do not rely on these alone:
- `send.disabled=false`
- file name text
- `uploaded-img`
- a visible preview without the send button becoming truly ready

Gemini is page-state sensitive.
The same button may expose a chooser in one page state and not in another.
When behavior becomes inconsistent, normalize back to the tested route above.

## Multi-image guidance

When multiple references are useful:
- pass them together in one chooser action when possible
- tell Gemini what each image contributes, such as subject, background, lighting, or color mood
- verify attachment readiness after the full batch, not only after the first file

## Native fallback helpers

Use `scripts/select_file_in_open_panel.sh <absolute-file-path> [timeout-seconds] [target-app]` only after Gemini already opened a real macOS file chooser.
That helper:
- waits for the open panel
- opens `前往文件夹`
- pastes the absolute path
- confirms the path
- clicks `打开` or `Open`

Use `scripts/chrome_ax_helper.swift` only for Accessibility / AXUIElement / CGEvent diagnostics or native-trigger fallback work.
Typical commands:
- `dump-windows`
- `dump-focused`
- `dump-tree --contains '上传文件'`
- `dump-attributes --contains '上传文件' --include-children`
- `press --contains '上传文件'`
- `wait-open-panel --timeout 15`
- `select-open-panel --path /absolute/file`

## Practical rule

Prefer browser-side chooser interception first.
Use native open-panel or AX routes only when Gemini does not expose a usable chooser and the browser has already crossed into native UI territory.
