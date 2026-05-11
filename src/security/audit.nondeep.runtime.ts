export {
  collectAttackSurfaceSummaryFindings,
  collectExposureMatrixFindings,
  collectGatewayHttpNoAuthFindings,
  collectGatewayHttpSessionKeyOverrideFindings,
  collectHooksHardeningFindings,
  collectLikelyMultiUserSetupFindings,
  collectMinimalProfileOverrideFindings,
  collectModelHygieneFindings,
  collectSecretsInConfigFindings,
  collectSmallModelRiskFindings,
  collectSyncedFolderFindings,
} from "./audit-extra.sync.js";

export {
  collectIncludeFilePermFindings,
  collectPluginsTrustFindings,
  collectStateDeepFilesystemFindings,
  collectWorkspaceSkillSymlinkEscapeFindings,
  readConfigSnapshotForAudit,
} from "./audit-extra.async.js";
