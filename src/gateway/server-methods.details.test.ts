import { describe, expect, it, vi } from "vitest";
import { GatewayRequestDetailCodes } from "./protocol/request-error-details.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";

const noWebchat = () => false;

function buildContext() {
  return {
    logGateway: {
      warn: vi.fn(),
    },
  } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"];
}

function buildClient(scopes: string[]) {
  return {
    connect: {
      role: "operator",
      scopes,
      client: {
        id: "crawclaw-browser-client",
        version: "1.0.0",
        platform: "darwin",
        mode: "ui",
      },
      minProtocol: 1,
      maxProtocol: 1,
    },
    connId: "conn-1",
  } as Parameters<typeof handleGatewayRequest>[0]["client"];
}

async function runRequest(params: {
  method: string;
  client: Parameters<typeof handleGatewayRequest>[0]["client"];
  handler?: GatewayRequestHandler;
}) {
  const respond = vi.fn();
  await handleGatewayRequest({
    req: {
      type: "req",
      id: crypto.randomUUID(),
      method: params.method,
    },
    respond,
    client: params.client,
    isWebchatConnect: noWebchat,
    context: buildContext(),
    extraHandlers: params.handler
      ? {
          [params.method]: params.handler,
        }
      : undefined,
  });
  return respond;
}

describe("gateway request detail codes", () => {
  it("attaches structured details for missing scopes", async () => {
    const handler: GatewayRequestHandler = (opts) => {
      opts.respond(true, { ok: true }, undefined);
    };

    const respond = await runRequest({
      method: "config.patch",
      client: buildClient(["operator.read"]),
      handler,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        details: expect.objectContaining({
          code: GatewayRequestDetailCodes.SCOPE_MISSING,
          missingScope: "operator.admin",
          method: "config.patch",
        }),
      }),
    );
  });

  it("attaches structured details for unknown methods", async () => {
    const respond = await runRequest({
      method: "totally.unknown.method",
      client: buildClient(["operator.admin"]),
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        details: expect.objectContaining({
          code: GatewayRequestDetailCodes.METHOD_UNAVAILABLE,
          method: "totally.unknown.method",
        }),
      }),
    );
  });
});
