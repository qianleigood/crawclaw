import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deleteGatewaySecret,
  getGatewaySecret,
  setGatewaySecret,
  type CredentialAdapter,
  type GatewaySecret,
} from './credential-store.js'

void test('gateway secrets are written through the credential adapter', async () => {
  const writes = new Map<string, string>()
  const adapter: CredentialAdapter = {
    async getPassword(_service, account) {
      return writes.get(account) ?? null
    },
    async setPassword(_service, account, password) {
      writes.set(account, password)
    },
    async deletePassword(_service, account) {
      return writes.delete(account)
    },
  }

  await setGatewaySecret('local', { token: 'token-value', password: 'password-value' }, { adapter })

  assert.equal(writes.get('gateway-token:local'), 'token-value')
  assert.equal(writes.get('gateway-password:local'), 'password-value')
  assert.deepEqual(await getGatewaySecret('local', { adapter }), {
    token: 'token-value',
    password: 'password-value',
  })

  await deleteGatewaySecret('local', { adapter })

  assert.equal(writes.size, 0)
})

void test('session-only fallback keeps gateway secrets in memory', async () => {
  const sessionSecrets = new Map<string, GatewaySecret>()

  await setGatewaySecret('session', { token: 'session-token' }, {
    adapter: null,
    allowSessionFallback: true,
    sessionSecrets,
  })

  assert.deepEqual(
    await getGatewaySecret('session', {
      adapter: null,
      allowSessionFallback: true,
      sessionSecrets,
    }),
    { token: 'session-token' }
  )
})

void test('session-only fallback handles credential adapter failures when enabled', async () => {
  const sessionSecrets = new Map<string, GatewaySecret>()
  const adapter: CredentialAdapter = {
    async getPassword() {
      throw new Error('credential store unavailable')
    },
    async setPassword() {
      throw new Error('credential store unavailable')
    },
    async deletePassword() {
      throw new Error('credential store unavailable')
    },
  }

  await setGatewaySecret('fallback', { password: 'session-password' }, {
    adapter,
    allowSessionFallback: true,
    sessionSecrets,
  })

  assert.deepEqual(
    await getGatewaySecret('fallback', {
      adapter,
      allowSessionFallback: true,
      sessionSecrets,
    }),
    { password: 'session-password' }
  )
})

void test('session-only fallback must be explicitly enabled', async () => {
  await assert.rejects(
    () => getGatewaySecret('blocked', { adapter: null }),
    /session-only fallback is not enabled/
  )
})
