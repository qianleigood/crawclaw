export type RuntimePackageArtifactsParams = {
  cwd?: string;
  rootDir?: string;
  cargoCwd?: string;
  runtimeBinary?: string;
};

export function listBundledPluginPackArtifacts(params?: RuntimePackageArtifactsParams): string[];

export function listStaticPackageAssetOutputs(params?: RuntimePackageArtifactsParams): string[];
