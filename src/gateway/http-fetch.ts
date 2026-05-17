import http from "node:http";
import https from "node:https";
import { normalizeFingerprint } from "../infra/tls/fingerprint.js";

export type GatewayHttpFetch = (
  url: string,
  init?: RequestInit,
  options?: { tlsFingerprint?: string },
) => Promise<Response>;

export const defaultGatewayHttpFetch: GatewayHttpFetch = async (url, init, options) => {
  const tlsFingerprint = options?.tlsFingerprint?.trim();
  if (!tlsFingerprint) {
    if (typeof globalThis.fetch !== "function") {
      throw new Error("Gateway HTTP RPC requires global fetch.");
    }
    return await globalThis.fetch(url, init);
  }
  return await fetchWithTlsFingerprint(url, init, tlsFingerprint);
};

function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

function headersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return { ...headers };
}

function requestBodyFromInit(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  throw new Error("unsupported gateway HTTP request body");
}

function responseHeadersFromIncoming(headers: http.IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        out.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      out.set(key, value);
    }
  }
  return out;
}

function validateResponseTlsFingerprint(
  response: http.IncomingMessage,
  expectedFingerprint: string,
): Error | null {
  const expected = normalizeFingerprint(expectedFingerprint);
  if (!expected) {
    return new Error("gateway tls fingerprint missing");
  }
  const socket = response.socket as { getPeerCertificate?: () => { fingerprint256?: string } };
  const cert = socket.getPeerCertificate?.();
  const actual = normalizeFingerprint(cert?.fingerprint256 ?? "");
  if (!actual) {
    return new Error("gateway tls fingerprint unavailable");
  }
  if (actual !== expected) {
    return new Error("gateway tls fingerprint mismatch");
  }
  return null;
}

async function fetchWithTlsFingerprint(
  url: string,
  init: RequestInit | undefined,
  tlsFingerprint: string,
): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("gateway tls fingerprint requires https gateway URL");
  }

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      init?.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      request.destroy(abortError());
    };
    const request = https.request(
      parsed,
      {
        method: init?.method ?? "GET",
        headers: headersFromInit(init?.headers),
        rejectUnauthorized: false,
      },
      (response) => {
        const tlsError = validateResponseTlsFingerprint(response, tlsFingerprint);
        if (tlsError) {
          response.resume();
          settle(() => reject(tlsError));
          request.destroy(tlsError);
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        response.on("end", () => {
          settle(() =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 200,
                statusText: response.statusMessage ?? "",
                headers: responseHeadersFromIncoming(response.headers),
              }),
            ),
          );
        });
      },
    );

    request.on("error", (error) => {
      settle(() => reject(error));
    });
    if (init?.signal?.aborted) {
      request.destroy(abortError());
      return;
    }
    init?.signal?.addEventListener("abort", onAbort, { once: true });
    const body = requestBodyFromInit(init?.body);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}
