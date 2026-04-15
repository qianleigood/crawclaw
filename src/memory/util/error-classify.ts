export type GmFailureKind =
  | "graph_store_error"
  | "vector_store_error"
  | "embedding_error"
  | "upstream_error"
  | "config_error"
  | "timeout_error"
  | "unknown_error";

export interface ClassifiedError {
  kind: GmFailureKind;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

function extractStatusCode(message: string): number | undefined {
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  if (!match) {return undefined;}
  return Number(match[1]);
}

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const statusCode = extractStatusCode(message);

  if (statusCode && statusCode >= 500) {
    return { kind: "upstream_error", message, retryable: true, statusCode };
  }

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort")) {
    return { kind: "timeout_error", message, retryable: true, statusCode };
  }

  if (lower.includes("dimension mismatch") || lower.includes("configured=") || lower.includes("config") || lower.includes("schema")) {
    return { kind: "config_error", message, retryable: false, statusCode };
  }

  if (lower.includes("embedding api") || lower.includes("embeddings") || lower.includes("embedding dimension") || lower.includes("vectorlength")) {
    return { kind: "embedding_error", message, retryable: !statusCode || statusCode >= 500, statusCode };
  }

  if (lower.includes("qdrant") || lower.includes("collection") || lower.includes("payload index") || lower.includes("vector store") || lower.includes("searchknowledge")) {
    return { kind: "vector_store_error", message, retryable: !(statusCode && statusCode < 500), statusCode };
  }

  if (lower.includes("neo4j") || lower.includes("bolt://") || lower.includes("verifyconnectivity") || lower.includes("cypher") || lower.includes("graph store")) {
    return { kind: "graph_store_error", message, retryable: !(statusCode && statusCode < 500), statusCode };
  }

  if (statusCode && statusCode >= 500) {
    return { kind: "upstream_error", message, retryable: true, statusCode };
  }

  return { kind: "unknown_error", message, retryable: false, statusCode };
}
