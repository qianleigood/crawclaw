import { describePackageManifestContract } from "../../../test/helpers/plugins/package-manifest-contract.js";

type PackageManifestContractParams = Parameters<typeof describePackageManifestContract>[0];

const packageManifestContractTests: PackageManifestContractParams[] = [
  { pluginId: "anthropic", minHostVersionBaseline: "2026.3.22" },
  { pluginId: "brave", minHostVersionBaseline: "2026.3.22" },
  { pluginId: "deepseek", minHostVersionBaseline: "2026.3.22" },
  { pluginId: "ollama", minHostVersionBaseline: "2026.3.22" },
  { pluginId: "openai", minHostVersionBaseline: "2026.3.22" },
  { pluginId: "voice-call", minHostVersionBaseline: "2026.3.22" },
];

for (const params of packageManifestContractTests) {
  describePackageManifestContract(params);
}
