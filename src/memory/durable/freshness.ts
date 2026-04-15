export function durableMemoryAgeDays(updatedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - updatedAt) / 86_400_000));
}

export function durableMemoryAge(updatedAt: number): string {
  const days = durableMemoryAgeDays(updatedAt);
  if (days === 0) {return "today";}
  if (days === 1) {return "yesterday";}
  return `${days} days ago`;
}

export function durableMemoryFreshnessText(updatedAt: number): string {
  const days = durableMemoryAgeDays(updatedAt);
  if (days <= 1) {return "";}
  return [
    `This durable memory is ${days} days old.`,
    "Durable memory is a point-in-time observation, not live state.",
    "Claims about code behavior, file paths, flags, or repo state may be outdated.",
    "Verify against current files, tools, or external resources before asserting it as fact.",
  ].join(" ");
}
