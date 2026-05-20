---
summary: "Plugin internals: capability model, ownership, contracts, load pipeline, and runtime helpers"
read_when:
  - Building or debugging native CrawClaw plugins
  - Understanding the plugin capability model or ownership boundaries
  - Working on the plugin load pipeline or registry
  - Implementing non-LLM provider capabilities
title: "Plugin Internals"
sidebarTitle: "Internals"
---

# Plugin Internals

<Info>
  This is the **deep architecture reference**. For practical guides, see:
  - [Install and use plugins](/tools/plugin) — user guide
  - [Getting Started](/plugins/building-plugins) — first plugin tutorial
  - [Provider Configuration](/plugins/sdk-provider-plugins) — configure Rust-owned model providers
  - [SDK Overview](/plugins/sdk-overview) — import map and registration API
</Info>

This page covers the internal architecture of the CrawClaw plugin system.

## Public capability model

Capabilities are the public **native plugin** model inside CrawClaw. Every
native CrawClaw plugin registers against one or more capability types:

| Capability          | Registration method    | Example plugins    |
| ------------------- | ---------------------- | ------------------ |
| Speech              | Rust native descriptor | `qwen3-tts`        |
| Media understanding | Rust native descriptor | `openai`, `google` |
| Web search          | Rust native descriptor | `searxng`          |

A plugin that registers zero capabilities but provides tools, commands, or
services is a **non-capability** plugin.

### External compatibility stance

The capability model is landed in core and used by bundled/native plugins
today, but external plugin compatibility still needs a tighter bar than "it is
exported, therefore it is frozen."

Current guidance:

- **existing external plugins:** keep hook-based integrations working; treat
  this as the compatibility baseline
- **new bundled/native plugins:** prefer explicit capability registration over
  vendor-specific reach-ins or new hook-only designs
- **external plugins adopting capability registration:** allowed, but treat the
  capability-specific helper surfaces as evolving unless docs explicitly mark a
  contract as stable

Practical rule:

- capability registration APIs are the intended direction
- legacy hooks remain the safest no-breakage path for external plugins during
  the transition
- exported helper subpaths are not all equal; prefer the narrow documented
  contract, not incidental helper exports

### Plugin shapes

CrawClaw classifies every loaded plugin into a shape based on its actual
registration behavior (not just static metadata):

- **plain-capability** -- registers exactly one capability type (for example a
  provider-only plugin like `mistral`)
- **hybrid-capability** -- registers multiple capability types (for example
  `openai` owns text inference, media understanding, and image generation)
- **hook-only** -- registers only hooks (typed or custom), no capabilities,
  tools, commands, or services
- **non-capability** -- registers tools, commands, services, or routes but no
  capabilities

Use CrawClaw Desktop or the local Gateway API to see a plugin's shape and capability
breakdown. See [Gateway API reference](/tools/plugin#inspect) for details.

### Runtime hooks

TypeScript typed runtime hooks have been removed. Provider/model resolution,
prompt assembly, and agent lifecycle behavior now run through the Rust provider
catalog and Rust agent runtime.

### Compatibility signals

When you run CrawClaw Desktop or the local Gateway API or CrawClaw Desktop or the local Gateway API, you may see
one of these labels:

| Signal                     | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------ |
| **config valid**           | Config parses fine and plugins resolve                       |
| **compatibility advisory** | Plugin uses a supported-but-older pattern (e.g. `hook-only`) |
| **hard error**             | Config is invalid or plugin failed to load                   |

`hook-only` is advisory only. These signals also appear in
CrawClaw Desktop or the local Gateway API and CrawClaw Desktop or the local Gateway API.

## Architecture overview

CrawClaw's plugin system has four layers:

1. **Manifest + discovery**
   CrawClaw finds candidate plugins from configured paths, workspace roots,
   global extension roots, and bundled extensions. Discovery reads native
   `crawclaw.plugin.json` manifests plus supported bundle manifests first.
2. **Enablement + validation**
   Core decides whether a discovered plugin is enabled, disabled, blocked, or
   selected for an exclusive slot such as memory.
3. **Runtime loading**
   CrawClaw reads plugin metadata and Rust native descriptors into a central
   registry. Compatible bundles are normalized into registry records without
   importing runtime code.
4. **Surface consumption**
   The rest of CrawClaw reads the registry to expose Rust-owned capabilities,
   provider setup, Desktop surfaces, and Gateway API actions.

The important design boundary:

- discovery + config validation should work from **manifest/schema metadata**
  without executing plugin code
- production runtime behavior comes from Rust Gateway/runtime or Rust native
  plugin descriptors

That split lets CrawClaw validate config, explain missing/disabled plugins, and
build UI/schema hints before the full runtime is active.

### Rust-native channel adapters

TypeScript channel plugins are no longer a production contract. The shared
message tool and channel control plane now route through Rust-native channel
descriptors and adapter contracts. Runtime capabilities such as providers,
tools, commands, hooks, services, speech, media, web fetch, and web search are
owned by Rust native registries or Rust Gateway/runtime code.

See [Load pipeline](#load-pipeline) for the full startup sequence.

## Capability ownership model

CrawClaw treats a native plugin as the ownership boundary for a **company** or a
**feature**, not as a grab bag of unrelated integrations.

That means:

- a company plugin should usually own all of that company's CrawClaw-facing
  surfaces
- a feature plugin should usually own the full feature surface it introduces
- channels should consume shared core capabilities instead of re-implementing
  provider behavior ad hoc

Examples:

- the bundled `openai` plugin owns OpenAI model-provider behavior and OpenAI
  media-understanding behavior
- the bundled `qwen3-tts` plugin owns local speech synthesis behavior
- the bundled `google` plugin owns Google model-provider behavior plus Google
  media-understanding + web-search behavior
- the bundled `minimax`, `mistral`, `moonshot`, and `zai` plugins own their
  media-understanding backends

The intended end state is:

- OpenAI lives in one plugin even if it spans text models, images, and
  future video
- another vendor can do the same for its own surface area
- channels do not care which vendor plugin owns the provider; they consume the
  shared capability contract exposed by core

This is the key distinction:

- **plugin** = ownership boundary
- **capability** = core contract that multiple plugins can implement or consume

So if CrawClaw adds a new domain such as video, the first question is not
"which provider should hardcode video handling?" The first question is "what is
the core video capability contract?" Once that contract exists, vendor plugins
can register against it and channel/feature plugins can consume it.

If the capability does not exist yet, the right move is usually:

1. define the missing capability in core
2. expose it through the Rust native registry or a typed Gateway RPC
3. wire channels/features against that capability
4. let vendor plugins declare Rust native implementations

This keeps ownership explicit while avoiding core behavior that depends on a
single vendor or a one-off plugin-specific code path.

### Capability layering

Use this mental model when deciding where code belongs:

- **core capability layer**: shared orchestration, policy, fallback, config
  merge rules, delivery semantics, and typed contracts
- **vendor plugin layer**: vendor-specific APIs, auth, model catalogs, speech
  synthesis, image generation, future video backends, usage endpoints
- **channel/feature layer**: native integrations that consume core capabilities
  and present them on a surface

For example, TTS follows this shape:

- core owns reply-time TTS policy, fallback order, prefs, and channel delivery
- `qwen3-tts` owns the bundled native synthesis implementation
- native channel and feature runtimes consume the shared speech helpers

That same pattern should be preferred for future capabilities.

### Multi-capability company plugin example

A company plugin should feel cohesive from the outside. If CrawClaw has shared
contracts for models, speech, media understanding, and web search, a vendor can
own all of its surfaces in one place:

```json
{
  "id": "exampleai",
  "name": "ExampleAI",
  "native": {
    "protocol": "crawclaw-native-plugin-jsonrpc",
    "schemaVersion": 1,
    "bin": "exampleai-sidecar"
  }
}
```

What matters is not the exact helper names. The shape matters:

- one plugin owns the vendor surface
- core still owns the capability contracts
- channels and feature runtimes consume Rust-owned capability contracts, not vendor code
- contract tests can assert that the plugin declares the capabilities it
  claims to own

### Capability example: video understanding

CrawClaw already treats image/audio/video understanding as one shared
capability. The same ownership model applies there:

1. core defines the media-understanding contract
2. vendor plugins expose `describeImage`, `transcribeAudio`, and
   `describeVideo` through Rust native descriptors as applicable
3. channels and feature plugins consume the shared core behavior instead of
   wiring directly to vendor code

That avoids baking one provider's video assumptions into core. The plugin owns
the vendor surface; core owns the capability contract and fallback behavior.

If CrawClaw adds a new domain later, such as video generation, use the same
sequence again: define the core capability first, then let vendor plugins
declare implementations against it.

Need a concrete rollout checklist? See
[Capability Cookbook](/tools/capability-cookbook).

## Contracts and enforcement

The plugin surface is intentionally typed and centralized in manifest schemas,
Rust native descriptors, and Gateway RPC definitions. Those contracts define
the supported runtime surfaces a plugin may rely on.

Why this matters:

- plugin authors get one stable internal standard
- core can reject duplicate ownership such as two plugins registering the same
  provider id
- startup can surface actionable diagnostics for malformed descriptors
- contract tests can enforce bundled-plugin ownership and prevent silent drift

There are two layers of enforcement:

1. **runtime descriptor enforcement**
   The plugin registry validates descriptors as plugins load. Examples:
   duplicate provider ids, duplicate speech provider ids, and malformed
   descriptors produce plugin diagnostics instead of undefined behavior.
2. **contract tests**
   Bundled plugins are checked through manifest/native descriptor tests so
   CrawClaw can assert ownership explicitly. Today this is used for model
   providers, speech providers, web search providers, and bundled descriptor
   ownership.

The practical effect is that CrawClaw knows, up front, which plugin owns which
surface. That lets core and channels compose seamlessly because ownership is
declared, typed, and testable rather than implicit.

### What belongs in a contract

Good plugin contracts are:

- typed
- small
- capability-specific
- owned by core
- reusable by multiple plugins
- consumable by channels/features without vendor knowledge

Bad plugin contracts are:

- vendor-specific policy hidden in core
- one-off plugin escape hatches that bypass the registry
- channel code reaching straight into a vendor implementation
- ad hoc TypeScript runtime objects that bypass the Rust native boundary

When in doubt, raise the abstraction level: define the capability first, then
let plugins plug into it.

## Execution model

Rust native CrawClaw plugins run inside the Rust Gateway/runtime boundary. They
are not TypeScript extension code.

Implications:

- a Rust native plugin can expose tools, network handlers, hooks, and services
- a native plugin bug can crash or destabilize the gateway/runtime
- a malicious native plugin is equivalent to arbitrary code execution inside the
  CrawClaw runtime boundary

Compatible bundles are safer by default because CrawClaw currently treats them
as metadata/content packs. In current releases, that mostly means bundled
skills.

Use allowlists and explicit install/load paths for non-bundled plugins. Treat
workspace plugins as development-time code, not production defaults.

For bundled workspace package names, keep the plugin id anchored in the npm
name: `@crawclaw/<id>` by default, or an approved typed suffix such as
the package intentionally exposes a narrower plugin role.

Important trust note:

- `plugins.allow` trusts **plugin ids**, not source provenance.
- A workspace plugin with the same id as a bundled plugin intentionally shadows
  the bundled copy when that workspace plugin is enabled/allowlisted.
- This is normal and useful for local development, patch testing, and hotfixes.

## Export boundary

CrawClaw exports capabilities, not implementation convenience.

Keep capability registration public. Trim non-contract helper exports:

- bundled-plugin-specific helper subpaths
- runtime plumbing subpaths not intended as public API
- vendor-specific convenience helpers
- setup/onboarding helpers that are implementation details

## Load pipeline

At startup, CrawClaw does roughly this:

1. discover candidate plugin roots
2. read native or compatible bundle manifests and package metadata
3. reject unsafe candidates
4. normalize plugin config (`plugins.enabled`, `allow`, `deny`, `entries`,
   `slots`, `load.paths`)
5. decide enablement for each candidate
6. collect declarative metadata and Rust native descriptors
7. expose the registry to Gateway/runtime surfaces

The safety gates happen **before** runtime execution. Candidates are blocked
when the entry escapes the plugin root, the path is world-writable, or path
ownership looks suspicious for non-bundled plugins.

### Manifest-first behavior

The manifest is the control-plane source of truth. CrawClaw uses it to:

- identify the plugin
- discover declared channels/skills/config schema or bundle capabilities
- validate `plugins.entries.<id>.config`
- augment browser-client labels/placeholders
- show install/catalog metadata

For native plugins, the Rust descriptor/runtime is the data-plane part. It owns
actual behavior such as hooks, tools, commands, services, or provider flows.

### What the loader caches

CrawClaw keeps short in-process caches for:

- discovery results
- manifest registry data
- loaded plugin registries

These caches reduce bursty startup and repeated command overhead. They are safe
to think of as short-lived performance caches, not persistence.

Performance note:

- Set `CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE=1` or
  `CRAWCLAW_DISABLE_PLUGIN_MANIFEST_CACHE=1` to disable these caches.
- Tune cache windows with `CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS` and
  `CRAWCLAW_PLUGIN_MANIFEST_CACHE_MS`.

## Registry model

Loaded plugins do not directly mutate random core globals. They register into a
central plugin registry.

The registry tracks:

- plugin records (identity, source, origin, status, diagnostics)
- tools
- workspace hook bundles
- channels
- providers
- gateway RPC handlers
- HTTP routes
- CLI registrars
- background services
- plugin-owned commands

Core features then read from that registry instead of talking to plugin modules
directly. This keeps loading one-way:

- plugin module -> registry registration
- core runtime -> registry consumption

That separation matters for maintainability. It means most core surfaces only
need one integration point: "read the registry", not "special-case every plugin
module".

## Conversation binding events

Conversation binding events are owned by the Rust runtime and internal Gateway
event bus. TypeScript plugins cannot register production callbacks for binding
resolution.

## Provider runtime ownership

TypeScript plugins no longer register model providers or runtime provider
hooks. Built-in provider metadata and runtime behavior live in
`crates/crawclaw-providers`; packaged desktop manifests receive the Rust-staged
provider records and keep provider setup/status cheap through declarative
metadata.

Provider plugins can still expose manifest metadata:

- `providerAuthEnvVars` describes environment credential probes.
- `providerAuthChoices` describes onboarding/setup labels.
- `models.providers` config entries describe custom provider endpoints and
  model rows.

Model resolution, auth preparation, request transport, usage snapshots,
transcript policy, prompt-cache policy, model catalog augmentation, and
provider-specific compatibility are Rust-owned runtime behavior. Add new
provider capabilities through the Rust provider registry and native descriptor
contracts, then expose only the required manifest fields to TypeScript
renderer or setup surfaces.

## Runtime helpers

TTS is a Rust Gateway and native-plugin surface. The default desktop path uses
the Rust `tts.*` Gateway methods and the bundled Rust native `qwen3-tts`
descriptor instead of TypeScript runtime helpers.

Speech providers now come from Rust native plugin descriptors. TypeScript
plugins do not register speech providers at runtime.

Notes:

- Keep TTS policy and provider metadata in Rust Gateway/native descriptors.
- Use speech providers for vendor-owned synthesis behavior through native
  descriptors.
- The preferred ownership model is company-oriented: one vendor plugin can own
  text, speech, image, and future media providers as CrawClaw adds those
  capability contracts.

For image/audio/video understanding, Rust native plugin descriptors declare the
provider and invocation target instead of a generic key/value bag.

Notes:

- Keep orchestration, fallback, config, and channel wiring in core.
- Keep vendor behavior in the provider plugin.
- Additive expansion should stay typed: new optional methods, new optional
  result fields, new optional capabilities.
- If CrawClaw adds a new capability such as video generation later, define the
  core capability contract first, then let vendor plugins register against it.

The old TypeScript media-understanding runtime helpers have been removed from
the public plugin SDK. Media understanding is now exposed through Rust native
runtime capabilities and declarative plugin descriptors, not TS plugin runtime
calls.

Plugins can also launch background subagent runs through `api.runtime.subagent`:

```ts
const result = await api.runtime.subagent.run({
  sessionKey: "agent:main:subagent:search-helper",
  message: "Expand this query into focused follow-up searches.",
  provider: "openai",
  model: "gpt-4.1-mini",
  deliver: false,
});
```

Notes:

- `provider` and `model` are optional per-run overrides, not persistent session changes.
- CrawClaw only honors those override fields for trusted callers.
- For plugin-owned fallback runs, operators must opt in with `plugins.entries.<id>.subagent.allowModelOverride: true`.
- Use `plugins.entries.<id>.subagent.allowedModels` to restrict trusted plugins to specific canonical `provider/model` targets, or `"*"` to allow any target explicitly.
- Untrusted plugin subagent runs still work, but override requests are rejected instead of silently falling back.

For web search, plugins can consume the shared runtime helper instead of
reaching into the agent tool wiring:

```ts
const providers = api.runtime.webSearch.listProviders({
  config: api.config,
});

const result = await api.runtime.webSearch.search({
  config: api.config,
  args: {
    query: "CrawClaw plugin runtime helpers",
    count: 5,
  },
});
```

Web-search providers now come from Rust native plugin descriptors.

Notes:

- Keep provider selection, credential resolution, and shared request semantics in core.
- Use web-search providers for vendor-specific search transports.
- `api.runtime.webSearch.*` is the preferred shared surface for feature/channel plugins that need search behavior without depending on the agent tool wrapper.

## Gateway HTTP routes

Production Gateway HTTP routes are owned by Rust Gateway or internal runtime
services. TypeScript plugins cannot register HTTP handlers.

## Rust plugin SDK boundary

The public plugin authoring SDK is the Rust crate `crawclaw-plugin-sdk`.
JavaScript plugin SDK package exports have been removed from the npm package.

- Use `NativePluginDescriptor` and capability descriptor helpers for public
  plugin metadata.
- Keep plugin discovery manifest-first. Discovery should not require executing
  JavaScript plugin code.
- Add new plugin-facing runtime capabilities to Rust crates and keep the JSON
  wire shape additive.
- Bundled extension internals remain private. Core and tests should read
  manifest/package metadata and Rust/native descriptors for repo-owned
  packages; external plugins should use the Rust SDK.
- Repo-private TypeScript helpers can exist only as implementation detail. They
  are not a public SDK and must not be exported as npm package subpaths.

## Message tool schemas

Plugins should own channel-specific `describeMessageTool(...)` schema
contributions. Keep provider-specific fields in the plugin, not in shared core.

If a schema shape only makes sense for one provider, define it in that plugin's
own source instead of promoting it into the shared SDK.

## Channel target resolution

Channel plugins should own channel-specific target semantics. Keep the shared
outbound host generic and use the messaging adapter surface for provider rules:

- `messaging.inferTargetChatType({ to })` decides whether a normalized target
  should be treated as `direct`, `group`, or `channel` before directory lookup.
- `messaging.targetResolver.looksLikeId(raw, normalized)` tells core whether an
  input should skip straight to id-like resolution instead of directory search.
- `messaging.targetResolver.resolveTarget(...)` is the plugin fallback when
  core needs a final provider-owned resolution after normalization or after a
  directory miss.
- `messaging.resolveOutboundSessionRoute(...)` owns provider-specific session
  route construction once a target is resolved.

Recommended split:

- Use `inferTargetChatType` for category decisions that should happen before
  searching peers/groups.
- Use `looksLikeId` for "treat this as an explicit/native target id" checks.
- Use `resolveTarget` for provider-specific normalization fallback, not for
  broad directory search.
- Keep provider-native ids like chat ids, thread ids, JIDs, handles, and room
  ids inside `target` values or provider-specific params, not in generic SDK
  fields.

## Config-backed directories

Plugins that derive directory entries from config should keep that logic in the
plugin or the Rust-native channel adapter.

Use this when a channel needs config-backed peers/groups such as:

- allowlist-driven DM peers
- configured channel/group maps
- account-scoped static directory fallbacks

The shared helpers in `directory-runtime` only handle generic operations:

- query filtering
- limit application
- deduping/normalization helpers
- building `ChannelDirectoryEntry[]`

Channel-specific account inspection and id normalization should stay in the
plugin implementation.

## Provider configuration

TypeScript plugins no longer register LLM providers or model catalogs. Provider
metadata, default models, config schema, auth choices, setup options, and native
transport capabilities are owned by the Rust provider registry.

Custom provider entries remain config-backed under `models.providers`. Use that
config path for OpenAI-compatible endpoints, local adapters, or provider entries
that should be user-managed instead of shipped in the Rust catalog.

## Read-only channel inspection

If your plugin registers a channel, prefer implementing
`plugin.config.inspectAccount(cfg, accountId)` alongside `resolveAccount(...)`.

Why:

- `resolveAccount(...)` is the runtime path. It is allowed to assume credentials
  are fully materialized and can fail fast when required secrets are missing.
- Read-only command paths such as CrawClaw Desktop or the local Gateway API, CrawClaw Desktop or the local Gateway API,
  CrawClaw Desktop or the local Gateway API, CrawClaw Desktop or the local Gateway API, and doctor/config
  repair flows should not need to materialize runtime credentials just to
  describe configuration.

Recommended `inspectAccount(...)` behavior:

- Return descriptive account state only.
- Preserve `enabled` and `configured`.
- Include credential source/status fields when relevant, such as:
  - `tokenSource`, `tokenStatus`
  - `botTokenSource`, `botTokenStatus`
  - `appTokenSource`, `appTokenStatus`
  - `signingSecretSource`, `signingSecretStatus`
- You do not need to return raw token values just to report read-only
  availability. Returning `tokenStatus: "available"` (and the matching source
  field) is enough for status-style commands.
- Use `configured_unavailable` when a credential is configured via SecretRef but
  unavailable in the current command path.

This lets read-only commands report "configured but unavailable in this command
path" instead of crashing or misreporting the account as not configured.

## Package metadata

Native plugins must package their executable/runtime files next to
`crawclaw.plugin.json`. CrawClaw Desktop and the local Gateway API no longer run
`npm install` while installing plugins, and published package contents must not
depend on a generated `node_modules` tree.

The legacy `crawclaw.extensions`, `crawclaw.setupEntry`, and
`deferConfiguredChannelFullLoadUntilAfterListen` package paths were removed with
the TypeScript plugin runtime. Native capability setup/status surfaces are owned
by Rust.

## Memory plugins

Custom session-memory behavior now lives on the built-in memory runtime path.
Plugins can still declare `kind: "memory"` in their manifest to participate in
exclusive memory-slot selection, but the old `context-engine` registration API
and plugin-owned compaction bridge have been removed.

## Adding a new capability

When a plugin needs behavior that does not fit the current API, do not bypass
the plugin system with a private reach-in. Add the missing capability.

Recommended sequence:

1. define the core contract
   Decide what shared behavior core should own: policy, fallback, config merge,
   lifecycle, channel-facing semantics, and runtime helper shape.
2. add Rust native descriptor or Gateway RPC surfaces
   Extend the Rust-owned contract with the smallest useful typed capability
   surface.
3. wire core + channel/feature consumers
   Channels and feature plugins should consume the new capability through core,
   not by importing a vendor implementation directly.
4. declare vendor implementations
   Vendor plugins then declare their backends through Rust native descriptors.
5. add contract coverage
   Add tests so ownership and descriptor shape stay explicit over time.

This is how CrawClaw stays opinionated without becoming hardcoded to one
provider's worldview. See the [Capability Cookbook](/tools/capability-cookbook)
for a concrete file checklist and worked example.

### Capability checklist

When you add a new capability, the implementation should usually touch these
surfaces together:

- core contract types in `src/<capability>/types.ts`
- core runner/runtime helper in `src/<capability>/runtime.ts`
- plugin API registration surface in `src/plugins/types.ts`
- Rust/native descriptor exposure in the owning Rust crate when feature/channel
  plugins need to consume runtime capabilities
- ownership/contract assertions in `src/plugins/contracts/registry.ts`
- operator/plugin docs in `docs/`

If one of those surfaces is missing, that is usually a sign the capability is
not fully integrated yet.

### Capability template

Minimal pattern:

```ts
// core contract
export type VideoGenerationProviderPlugin = {
  id: string;
  label: string;
  generateVideo: (req: VideoGenerationRequest) => Promise<VideoGenerationResult>;
};

// Native plugin descriptors are the runtime extension mechanism for new
// provider-like capabilities.

// shared runtime helper for feature/channel plugins
const clip = await api.runtime.videoGeneration.generateFile({
  prompt: "Show the robot walking through the lab.",
  cfg,
});
```

Contract test pattern:

```ts
expect(findVideoGenerationProviderIdsForPlugin("openai")).toEqual(["openai"]);
```

That keeps the rule simple:

- core owns the capability contract + orchestration
- vendor plugins own vendor implementations
- feature/channel plugins consume runtime helpers
- contract tests keep ownership explicit
