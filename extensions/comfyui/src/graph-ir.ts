export type ComfyMediaKind = "image" | "video" | "audio" | "mixed";
export type ComfyIntent =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "mixed"
  | "custom";

export type ComfyGraphIrNode = {
  id: string;
  classType: string;
  purpose: string;
  inputs: Record<string, unknown>;
};

export type ComfyGraphIrEdge = {
  from: string;
  fromOutput: number;
  to: string;
  toInput: string;
};

export type ComfyGraphIrOutput = {
  nodeId: string;
  kind: "image" | "video" | "audio" | "unknown";
};

export type ComfyGraphIr = {
  id: string;
  goal: string;
  mediaKind: ComfyMediaKind;
  intent: ComfyIntent;
  nodes: ComfyGraphIrNode[];
  edges: ComfyGraphIrEdge[];
  outputs: ComfyGraphIrOutput[];
  notes?: string;
};

export type ComfyDiagnosticCode =
  | "invalid_ir"
  | "missing_node_class"
  | "missing_required_input"
  | "missing_reference"
  | "invalid_choice"
  | "type_mismatch"
  | "missing_video_output_node"
  | "missing_image_output_node"
  | "planner_unavailable";

export type ComfyGraphDiagnostic = {
  code: ComfyDiagnosticCode;
  severity: "error" | "warning";
  nodeId?: string;
  classType?: string;
  field?: string;
  message: string;
  repairHint?: string;
};

export type ComfyOutputArtifact = {
  kind: "image" | "video" | "audio" | "unknown";
  nodeId: string;
  filename: string;
  subfolder?: string;
  type?: string;
  mime?: string;
  localPath?: string;
};

export type ComfyApiPrompt = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseGraphIr(value: unknown): ComfyGraphIr | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.mediaKind !== "string" ||
    typeof value.intent !== "string" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.outputs)
  ) {
    return null;
  }
  return value as ComfyGraphIr;
}
