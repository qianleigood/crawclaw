import type { Model } from "@mariozechner/pi-ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createAnthropicVertexStreamFnForModel = vi.fn();
const ensureCustomApiRegistered = vi.fn();

vi.mock("./anthropic-vertex-stream.js", () => ({
  createAnthropicVertexStreamFnForModel,
}));

vi.mock("./custom-api-registry.js", () => ({
  ensureCustomApiRegistered,
}));

let prepareModelForSimpleCompletion: typeof import("./simple-completion-transport.js").prepareModelForSimpleCompletion;

describe("prepareModelForSimpleCompletion", () => {
  beforeAll(async () => {
    ({ prepareModelForSimpleCompletion } = await import("./simple-completion-transport.js"));
  });

  beforeEach(() => {
    createAnthropicVertexStreamFnForModel.mockReset();
    ensureCustomApiRegistered.mockReset();
    createAnthropicVertexStreamFnForModel.mockReturnValue("vertex-stream");
  });

  it("keeps Ollama on the native registered api without TS stream registration", () => {
    const model: Model<"ollama"> = {
      id: "llama3",
      name: "Llama 3",
      api: "ollama",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
      headers: {},
    };

    const result = prepareModelForSimpleCompletion({
      model,
    });

    expect(ensureCustomApiRegistered).not.toHaveBeenCalled();
    expect(result).toBe(model);
  });

  it("uses a custom api alias for Anthropic Vertex simple completions", () => {
    const model: Model<"anthropic-messages"> = {
      id: "claude-sonnet",
      name: "Claude Sonnet",
      api: "anthropic-messages",
      provider: "anthropic-vertex",
      baseUrl: "https://us-central1-aiplatform.googleapis.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    const result = prepareModelForSimpleCompletion({ model });

    expect(createAnthropicVertexStreamFnForModel).toHaveBeenCalledWith(model);
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith(
      "crawclaw-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
      "vertex-stream",
    );
    expect(result).toEqual({
      ...model,
      api: "crawclaw-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
    });
  });
});
