export function cleanPrompt(raw: string): string {
  return raw
    .replace(/^\s*\[[^\]]{1,160}\]\s*/u, "")
    .replace(/^\[message_id:[^\]]+\]\s*$/gim, "")
    .replace(/^([^:\n]{1,40}):\s*/gm, "")
    .trim();
}
