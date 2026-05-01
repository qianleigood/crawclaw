export function createEmptyRequirements() {
  return {
    bins: [],
    anyBins: [],
    env: [],
    config: [],
    os: [],
    arch: [],
  };
}

export function createEmptyInstallChecks() {
  return {
    requirements: createEmptyRequirements(),
    missing: createEmptyRequirements(),
    configChecks: [],
    install: [],
  };
}
