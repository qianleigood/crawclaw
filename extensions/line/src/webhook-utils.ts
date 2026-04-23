import type { WebhookRequestBody } from "./line-sdk-types.js";
export { validateLineSignature } from "./signature.js";

export function parseLineWebhookBody(rawBody: string): WebhookRequestBody | null {
  try {
    return JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    return null;
  }
}
