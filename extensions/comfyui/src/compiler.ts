import type { ComfyApiPrompt, ComfyGraphIr } from "./graph-ir.js";

export function compileGraphIrToPrompt(ir: ComfyGraphIr): ComfyApiPrompt {
  const nodeIdMap = new Map(ir.nodes.map((node, index) => [node.id, String(index + 1)]));
  const prompt: ComfyApiPrompt = {};
  for (const node of ir.nodes) {
    const promptId = nodeIdMap.get(node.id);
    if (!promptId) {
      continue;
    }
    prompt[promptId] = {
      class_type: node.classType,
      inputs: { ...node.inputs },
    };
  }
  for (const edge of ir.edges) {
    const from = nodeIdMap.get(edge.from);
    const to = nodeIdMap.get(edge.to);
    if (!from || !to) {
      continue;
    }
    prompt[to]!.inputs[edge.toInput] = [from, edge.fromOutput];
  }
  return prompt;
}
