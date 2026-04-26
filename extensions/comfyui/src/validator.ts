import type { ComfyNodeCatalog, ComfyNodeSpec } from "./catalog.js";
import type { ComfyGraphDiagnostic, ComfyGraphIr } from "./graph-ir.js";

export type ComfyValidationResult = {
  ok: boolean;
  diagnostics: ComfyGraphDiagnostic[];
};

function hasInput(ir: ComfyGraphIr, nodeId: string, inputName: string): boolean {
  const node = ir.nodes.find((entry) => entry.id === nodeId);
  return (
    Boolean(node && Object.hasOwn(node.inputs, inputName)) ||
    ir.edges.some((edge) => edge.to === nodeId && edge.toInput === inputName)
  );
}

function outputType(node: ComfyNodeSpec | undefined, outputIndex: number): string | undefined {
  return node?.outputs[outputIndex];
}

function inputType(node: ComfyNodeSpec | undefined, inputName: string): string | undefined {
  return [...(node?.requiredInputs ?? []), ...(node?.optionalInputs ?? [])].find(
    (input) => input.name === inputName,
  )?.type;
}

function isCompatibleType(from?: string, to?: string): boolean {
  if (!from || !to || to === "ENUM") {
    return true;
  }
  return from === to;
}

function validateRequiredInputs(
  ir: ComfyGraphIr,
  catalogNode: ComfyNodeSpec,
  diagnostics: ComfyGraphDiagnostic[],
  nodeId: string,
) {
  for (const input of catalogNode.requiredInputs) {
    if (hasInput(ir, nodeId, input.name)) {
      continue;
    }
    diagnostics.push({
      code: "missing_required_input",
      severity: "error",
      nodeId,
      classType: catalogNode.classType,
      field: input.name,
      message: `Missing required input "${input.name}" for ${catalogNode.classType}.`,
      repairHint: input.defaultValue !== undefined ? "Fill the ComfyUI default value." : undefined,
    });
  }
}

function validateChoices(
  ir: ComfyGraphIr,
  catalogNode: ComfyNodeSpec,
  diagnostics: ComfyGraphDiagnostic[],
  nodeId: string,
) {
  const node = ir.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return;
  }
  for (const input of [...catalogNode.requiredInputs, ...catalogNode.optionalInputs]) {
    if (!input.choices || !Object.hasOwn(node.inputs, input.name)) {
      continue;
    }
    const value = node.inputs[input.name];
    if (typeof value === "string" && !input.choices.includes(value)) {
      diagnostics.push({
        code: "invalid_choice",
        severity: "error",
        nodeId,
        classType: catalogNode.classType,
        field: input.name,
        message: `Invalid value "${value}" for ${catalogNode.classType}.${input.name}.`,
        repairHint: `Choose one of: ${input.choices.join(", ")}`,
      });
    }
  }
}

export function validateGraphIr(
  ir: ComfyGraphIr,
  catalog: ComfyNodeCatalog,
): ComfyValidationResult {
  const diagnostics: ComfyGraphDiagnostic[] = [];
  const byId = new Map(ir.nodes.map((node) => [node.id, node]));
  for (const node of ir.nodes) {
    const catalogNode = catalog.getNode(node.classType);
    if (!catalogNode) {
      diagnostics.push({
        code: "missing_node_class",
        severity: "error",
        nodeId: node.id,
        classType: node.classType,
        message: `ComfyUI node class "${node.classType}" is not available locally.`,
      });
      continue;
    }
    validateRequiredInputs(ir, catalogNode, diagnostics, node.id);
    validateChoices(ir, catalogNode, diagnostics, node.id);
  }

  for (const edge of ir.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      diagnostics.push({
        code: "missing_reference",
        severity: "error",
        nodeId: to?.id,
        field: edge.toInput,
        message: `Invalid edge reference ${edge.from} -> ${edge.to}.${edge.toInput}.`,
      });
      continue;
    }
    const fromType = outputType(catalog.getNode(from.classType), edge.fromOutput);
    const toType = inputType(catalog.getNode(to.classType), edge.toInput);
    if (!isCompatibleType(fromType, toType)) {
      diagnostics.push({
        code: "type_mismatch",
        severity: "warning",
        nodeId: to.id,
        field: edge.toInput,
        message: `Edge ${edge.from} output ${edge.fromOutput} (${fromType}) may not match ${to.classType}.${edge.toInput} (${toType}).`,
      });
    }
  }

  if (ir.mediaKind === "video" && catalog.findVideoOutputNodes().length === 0) {
    diagnostics.push({
      code: "missing_video_output_node",
      severity: "error",
      message: "The local ComfyUI catalog does not expose a video output/combine node.",
      repairHint: "Install or enable a local video output node pack, then refresh the catalog.",
    });
  }
  if (ir.mediaKind === "image" && catalog.findImageOutputNodes().length === 0) {
    diagnostics.push({
      code: "missing_image_output_node",
      severity: "error",
      message: "The local ComfyUI catalog does not expose an image output node.",
    });
  }

  return { ok: diagnostics.every((diag) => diag.severity !== "error"), diagnostics };
}
