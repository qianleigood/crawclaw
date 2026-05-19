import RUST_TOOL_CATALOG_JSON from "../generated/agents/rust-tool-catalog.generated.json" with { type: "json" };

type RustToolCatalogSection = {
  readonly id: string;
  readonly label: string;
};

type RustToolCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly sectionId: string;
  readonly defaultProfiles: readonly string[];
  readonly lifecycle: string;
  readonly includeInCrawClawGroup: boolean;
};

type RustToolCatalogPayload = {
  readonly sections: readonly RustToolCatalogSection[];
  readonly coreTools: readonly RustToolCatalogEntry[];
  readonly nativeTools: readonly RustToolCatalogEntry[];
};

const RUST_TOOL_CATALOG = RUST_TOOL_CATALOG_JSON as RustToolCatalogPayload;

export const RUST_CORE_TOOL_SECTIONS = RUST_TOOL_CATALOG.sections;
export const RUST_CORE_TOOL_DEFINITIONS = RUST_TOOL_CATALOG.coreTools;
export const RUST_NATIVE_TOOL_DEFINITIONS = RUST_TOOL_CATALOG.nativeTools;
