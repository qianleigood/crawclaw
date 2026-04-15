# Output Capture

Use this reference when Gemini has already generated an image and the job needs a real saved file.

## Save order

Use this order:
1. Try Gemini's visible download or export action.
2. If Gemini opens the image in a new tab or modal, capture the highest-quality version available there.
3. If the page only exposes a rendered blob image and the visible download control does not produce a file, export the loaded image from the page itself.
4. Fall back to screenshot capture only when higher-quality extraction is unavailable.

## Verification rule

Do not say the image was downloaded until a real local file exists.
A visible `下载完整尺寸的图片` button is not proof of a saved file.
Always check the target path or download directory after the action.

## Blob export fallback

When Gemini renders a blob image in-page, prefer page-side export over screenshot.
Typical pattern:
1. Locate the generated `img`.
2. Draw it into a temporary in-page canvas.
3. Call `canvas.toDataURL('image/png')`.
4. Decode the data and write a real PNG locally.

Use screenshot fallback only when blob export or direct download is unavailable.

## Reporting

Always report:
- what was generated or edited
- the actual saved local path or paths
- whether the file was also sent back through chat
- any limitation that forced a fallback, such as blob export or screenshot capture

## Send-back rule

When the user asks to send the result, send the actual file through the current channel whenever the channel supports file transfer.
Do not send only a link or local path when direct file sending is available.
