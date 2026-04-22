export type NodeMatchCandidate = {
  nodeId: string;
  displayName?: string;
  remoteIp?: string;
  connected?: boolean;
  clientId?: string;
};

type ScoredNodeMatch = {
  node: NodeMatchCandidate;
  matchScore: number;
  selectionScore: number;
};

export function normalizeNodeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function listKnownNodes(nodes: NodeMatchCandidate[]): string {
  return nodes
    .map((n) => n.displayName || n.remoteIp || n.nodeId)
    .filter(Boolean)
    .join(", ");
}

function formatNodeCandidateLabel(node: NodeMatchCandidate): string {
  const label = node.displayName || node.remoteIp || node.nodeId;
  const details = [`node=${node.nodeId}`];
  if (typeof node.clientId === "string" && node.clientId.trim()) {
    details.push(`client=${node.clientId.trim()}`);
  }
  return `${label} [${details.join(", ")}]`;
}

function isCurrentCrawClawClient(clientId: string | undefined): boolean {
  const normalized = clientId?.trim().toLowerCase() ?? "";
  return normalized.startsWith("crawclaw-");
}

function resolveMatchScore(
  node: NodeMatchCandidate,
  query: string,
  queryNormalized: string,
): number {
  if (node.nodeId === query) {
    return 4_000;
  }
  if (typeof node.remoteIp === "string" && node.remoteIp === query) {
    return 3_000;
  }
  const name = typeof node.displayName === "string" ? node.displayName : "";
  if (name && normalizeNodeKey(name) === queryNormalized) {
    return 2_000;
  }
  if (query.length >= 6 && node.nodeId.startsWith(query)) {
    return 1_000;
  }
  return 0;
}

function scoreNodeCandidate(node: NodeMatchCandidate, matchScore: number): number {
  let score = matchScore;
  if (node.connected === true) {
    score += 100;
  }
  if (isCurrentCrawClawClient(node.clientId)) {
    score += 10;
  }
  return score;
}

function resolveScoredMatches(nodes: NodeMatchCandidate[], query: string): ScoredNodeMatch[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const normalized = normalizeNodeKey(trimmed);
  return nodes
    .map((node) => {
      const matchScore = resolveMatchScore(node, trimmed, normalized);
      if (matchScore === 0) {
        return null;
      }
      return {
        node,
        matchScore,
        selectionScore: scoreNodeCandidate(node, matchScore),
      };
    })
    .filter((entry): entry is ScoredNodeMatch => entry !== null);
}

export function resolveNodeMatches(
  nodes: NodeMatchCandidate[],
  query: string,
): NodeMatchCandidate[] {
  return resolveScoredMatches(nodes, query).map((entry) => entry.node);
}

export function resolveNodeIdFromCandidates(nodes: NodeMatchCandidate[], query: string): string {
  const q = query.trim();
  if (!q) {
    throw new Error("node required");
  }

  const rawMatches = resolveScoredMatches(nodes, q);
  if (rawMatches.length === 1) {
    return rawMatches[0]?.node.nodeId ?? "";
  }
  if (rawMatches.length === 0) {
    const known = listKnownNodes(nodes);
    throw new Error(`unknown node: ${q}${known ? ` (known: ${known})` : ""}`);
  }

  const topMatchScore = Math.max(...rawMatches.map((match) => match.matchScore));
  const strongestMatches = rawMatches.filter((match) => match.matchScore === topMatchScore);
  if (strongestMatches.length === 1) {
    return strongestMatches[0]?.node.nodeId ?? "";
  }

  const topSelectionScore = Math.max(...strongestMatches.map((match) => match.selectionScore));
  const matches = strongestMatches.filter((match) => match.selectionScore === topSelectionScore);
  if (matches.length === 1) {
    return matches[0]?.node.nodeId ?? "";
  }

  throw new Error(
    `ambiguous node: ${q} (matches: ${matches.map((match) => formatNodeCandidateLabel(match.node)).join(", ")})`,
  );
}
