import { createRequire } from "node:module";

export type UndiciRuntimeDeps = {
  Agent: typeof import("undici").Agent;
  EnvHttpProxyAgent: typeof import("undici").EnvHttpProxyAgent;
  ProxyAgent: typeof import("undici").ProxyAgent;
};

export function loadUndiciRuntimeDeps(): UndiciRuntimeDeps {
  const require = createRequire(import.meta.url);
  const undici = require("undici") as typeof import("undici");
  return {
    Agent: undici.Agent,
    EnvHttpProxyAgent: undici.EnvHttpProxyAgent,
    ProxyAgent: undici.ProxyAgent,
  };
}
