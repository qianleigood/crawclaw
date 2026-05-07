export function resolveUpdateMode(runtimeMode) {
  return runtimeMode === 'desktop' ? 'desktop-release' : 'npm-global'
}

export function buildDesktopUpdateResponse() {
  return {
    ok: false,
    updateMode: 'desktop-release',
    error: 'Desktop builds update through GitHub Releases.',
  }
}

export function buildNpmPackageSpec(packageName, version) {
  const requestedVersion = typeof version === 'string' ? version.trim() : ''
  return requestedVersion ? `${packageName}@${requestedVersion}` : `${packageName}@latest`
}

export function runAdminUpdate({ runtimeMode, packageName, version, execNpmUpdate }) {
  if (resolveUpdateMode(runtimeMode) === 'desktop-release') {
    return buildDesktopUpdateResponse()
  }

  const packageSpec = buildNpmPackageSpec(packageName, version)
  const output = execNpmUpdate(packageSpec)
  return {
    ok: true,
    updateMode: 'npm-global',
    message: `Successfully updated to ${packageSpec}`,
    output,
  }
}
