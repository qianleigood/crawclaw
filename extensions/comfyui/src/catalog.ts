import { createHash } from "node:crypto";
import { isRecord } from "./graph-ir.js";

export type ComfyInputSpec = {
  name: string;
  type?: string;
  required: boolean;
  defaultValue?: unknown;
  choices?: string[];
};

export type ComfyNodeSpec = {
  classType: string;
  displayName?: string;
  category?: string;
  requiredInputs: ComfyInputSpec[];
  optionalInputs: ComfyInputSpec[];
  outputs: string[];
  outputNames: string[];
};

export type ComfyNodeCatalog = {
  fingerprint: string;
  nodes: ComfyNodeSpec[];
  getNode(classType: string): ComfyNodeSpec | undefined;
  findByClassName(pattern: RegExp): ComfyNodeSpec[];
  findVideoOutputNodes(): ComfyNodeSpec[];
  findImageOutputNodes(): ComfyNodeSpec[];
};

function normalizeOutput(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry));
}

function parseInputTuple(
  value: unknown,
): Pick<ComfyInputSpec, "type" | "choices" | "defaultValue"> {
  if (!Array.isArray(value)) {
    return {};
  }
  const first = value[0];
  const second = value[1];
  const result: Pick<ComfyInputSpec, "type" | "choices" | "defaultValue"> = {};
  if (Array.isArray(first)) {
    result.choices = first.map((entry) => String(entry));
    result.type = "ENUM";
  } else if (typeof first === "string") {
    result.type = first;
  }
  if (isRecord(second) && "default" in second) {
    result.defaultValue = second.default;
  }
  return result;
}

function normalizeInputs(inputBlock: unknown, required: boolean): ComfyInputSpec[] {
  if (!isRecord(inputBlock)) {
    return [];
  }
  return Object.entries(inputBlock)
    .map(([name, value]) => ({ name, required, ...parseInputTuple(value) }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

function normalizeNode(classType: string, value: unknown): ComfyNodeSpec {
  const record = isRecord(value) ? value : {};
  const input = isRecord(record.input) ? record.input : {};
  return {
    classType,
    displayName: typeof record.display_name === "string" ? record.display_name : undefined,
    category: typeof record.category === "string" ? record.category : undefined,
    requiredInputs: normalizeInputs(input.required, true),
    optionalInputs: normalizeInputs(input.optional, false),
    outputs: normalizeOutput(record.output),
    outputNames: normalizeOutput(record.output_name),
  };
}

function hasSignal(node: ComfyNodeSpec, pattern: RegExp): boolean {
  const text = [
    node.classType,
    node.displayName,
    node.category,
    ...node.outputs,
    ...node.outputNames,
  ]
    .filter(Boolean)
    .join(" ");
  return pattern.test(text);
}

export function normalizeNodeCatalog(objectInfo: unknown): ComfyNodeCatalog {
  const record = isRecord(objectInfo) ? objectInfo : {};
  const nodes = Object.entries(record)
    .map(([classType, value]) => normalizeNode(classType, value))
    .toSorted((a, b) => a.classType.localeCompare(b.classType));
  const byClass = new Map(nodes.map((node) => [node.classType, node]));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        nodes.map((node) => ({ c: node.classType, i: node.requiredInputs, o: node.outputs })),
      ),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    fingerprint,
    nodes,
    getNode: (classType) => byClass.get(classType),
    findByClassName: (pattern) => nodes.filter((node) => pattern.test(node.classType)),
    findVideoOutputNodes: () =>
      nodes.filter(
        (node) =>
          hasSignal(node, /video|vhs|animate|wan|hunyuan|svd|frame|temporal/i) &&
          (node.outputs.length === 0 || hasSignal(node, /video|vhs|file|image/i)),
      ),
    findImageOutputNodes: () =>
      nodes.filter(
        (node) =>
          hasSignal(node, /save.?image|image/i) &&
          (node.outputs.length === 0 || hasSignal(node, /image/i)),
      ),
  };
}
