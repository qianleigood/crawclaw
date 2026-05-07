const SERVICE_NAME = 'CrawClaw Admin'
const gatewaySessionSecrets = new Map<string, GatewaySecret>()
let defaultAdapterPromise: Promise<CredentialAdapter | null> | undefined

export interface GatewaySecret {
  token?: string
  password?: string
}

export interface CredentialAdapter {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

export interface CredentialStoreOptions {
  adapter?: CredentialAdapter | null
  allowSessionFallback?: boolean
  sessionSecrets?: Map<string, GatewaySecret>
}

export async function getGatewaySecret(
  profileId: string,
  options: CredentialStoreOptions = {}
): Promise<GatewaySecret> {
  const adapter = await resolveCredentialAdapter(options)
  if (!adapter) {
    return readSessionSecret(profileId, options)
  }

  try {
    const [token, password] = await Promise.all([
      adapter.getPassword(SERVICE_NAME, gatewayTokenAccount(profileId)),
      adapter.getPassword(SERVICE_NAME, gatewayPasswordAccount(profileId)),
    ])

    return compactSecret({ token: token ?? undefined, password: password ?? undefined })
  } catch (error) {
    if (options.allowSessionFallback) {
      return readSessionSecret(profileId, options)
    }
    throw error
  }
}

export async function setGatewaySecret(
  profileId: string,
  value: GatewaySecret,
  options: CredentialStoreOptions = {}
): Promise<void> {
  const adapter = await resolveCredentialAdapter(options)
  if (!adapter) {
    writeSessionSecret(profileId, value, options)
    return
  }

  try {
    await Promise.all([
      writeAdapterValue(adapter, gatewayTokenAccount(profileId), value.token),
      writeAdapterValue(adapter, gatewayPasswordAccount(profileId), value.password),
    ])
  } catch (error) {
    if (options.allowSessionFallback) {
      writeSessionSecret(profileId, value, options)
      return
    }
    throw error
  }
}

export async function deleteGatewaySecret(
  profileId: string,
  options: CredentialStoreOptions = {}
): Promise<void> {
  const adapter = await resolveCredentialAdapter(options)
  if (!adapter) {
    sessionSecretStore(options).delete(profileId)
    return
  }

  try {
    await Promise.all([
      adapter.deletePassword(SERVICE_NAME, gatewayTokenAccount(profileId)),
      adapter.deletePassword(SERVICE_NAME, gatewayPasswordAccount(profileId)),
    ])
  } catch (error) {
    if (options.allowSessionFallback) {
      sessionSecretStore(options).delete(profileId)
      return
    }
    throw error
  }
}

async function resolveCredentialAdapter(
  options: CredentialStoreOptions
): Promise<CredentialAdapter | null> {
  if (options.adapter !== undefined) {
    return options.adapter
  }
  defaultAdapterPromise ??= import('keytar')
    .then((module) => module)
    .catch(() => null)
  return defaultAdapterPromise
}

function readSessionSecret(profileId: string, options: CredentialStoreOptions): GatewaySecret {
  if (!options.allowSessionFallback) {
    throw new Error('OS credential storage is unavailable; session-only fallback is not enabled')
  }
  return compactSecret(sessionSecretStore(options).get(profileId) ?? {})
}

function writeSessionSecret(
  profileId: string,
  value: GatewaySecret,
  options: CredentialStoreOptions
): void {
  if (!options.allowSessionFallback) {
    throw new Error('OS credential storage is unavailable; session-only fallback is not enabled')
  }
  sessionSecretStore(options).set(profileId, compactSecret(value))
}

function sessionSecretStore(options: CredentialStoreOptions): Map<string, GatewaySecret> {
  return options.sessionSecrets ?? gatewaySessionSecrets
}

async function writeAdapterValue(
  adapter: CredentialAdapter,
  account: string,
  value: string | undefined
): Promise<void> {
  if (value?.trim()) {
    await adapter.setPassword(SERVICE_NAME, account, value)
    return
  }
  await adapter.deletePassword(SERVICE_NAME, account)
}

function compactSecret(secret: GatewaySecret): GatewaySecret {
  const compacted: GatewaySecret = {}
  if (secret.token?.trim()) {
    compacted.token = secret.token
  }
  if (secret.password?.trim()) {
    compacted.password = secret.password
  }
  return compacted
}

function gatewayTokenAccount(profileId: string): string {
  return `gateway-token:${profileId}`
}

function gatewayPasswordAccount(profileId: string): string {
  return `gateway-password:${profileId}`
}
