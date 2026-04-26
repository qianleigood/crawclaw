import type { ComfyNodeCatalog } from "./catalog.js";
import type { ComfyGraphDiagnostic, ComfyGraphIr } from "./graph-ir.js";

export type ComfyRepair = {
  code: "filled_default_input";
  nodeId: string;
  field: string;
};

export type RepairGraphIrParams = {
  ir: ComfyGraphIr;
  catalog: ComfyNodeCatalog;
  diagnostics: ComfyGraphDiagnostic[];
};

export function repairGraphIr(params: RepairGraphIrParams): {
  ir: ComfyGraphIr;
  repairs: ComfyRepair[];
} {
  const repairs: ComfyRepair[] = [];
  const nodes = params.ir.nodes.map((node) => ({ ...node, inputs: { ...node.inputs } }));
  for (const diag of params.diagnostics) {
    if (diag.code !== "missing_required_input" || !diag.nodeId || !diag.field) {
      continue;
    }
    const node = nodes.find((entry) => entry.id === diag.nodeId);
    const spec = node ? params.catalog.getNode(node.classType) : undefined;
    const input = spec?.requiredInputs.find((entry) => entry.name === diag.field);
    if (!node || !input || input.defaultValue === undefined) {
      continue;
    }
    node.inputs[diag.field] = input.defaultValue;
    repairs.push({ code: "filled_default_input", nodeId: node.id, field: diag.field });
  }
  return { ir: { ...params.ir, nodes }, repairs };
}
