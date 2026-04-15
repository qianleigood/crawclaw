export type WorkflowN8nConfig = {
  /** n8n base URL, for example https://n8n.example.com */
  baseUrl?: string;
  /** n8n API key, sent as X-N8N-API-KEY. */
  apiKey?: string;
  /** Optional n8n project ID for created workflows. */
  projectId?: string;
  /** External CrawClaw Gateway base URL reachable by n8n callback nodes. */
  callbackBaseUrl?: string;
  /** Optional n8n credential id to attach to CrawClaw callback HTTP nodes. */
  callbackCredentialId?: string;
  /** Optional n8n credential name paired with callbackCredentialId. */
  callbackCredentialName?: string;
  /**
   * Environment variable name that n8n should read for the CrawClaw Gateway
   * bearer token. Default: CRAWCLAW_GATEWAY_TOKEN.
   */
  callbackBearerEnvVar?: string;
  /** Optional literal bearer token injected into callback nodes at compile time. */
  callbackBearerToken?: string;
};

export type WorkflowConfig = {
  n8n?: WorkflowN8nConfig;
};
