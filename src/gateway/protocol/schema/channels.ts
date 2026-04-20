import { Type, type Static } from "@sinclair/typebox";
import { ConfigUiHintSchema } from "./config.js";
import { NonEmptyString, SecretInputSchema } from "./primitives.js";

export const TalkModeParamsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    phase: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TalkConfigParamsSchema = Type.Object(
  {
    includeSecrets: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TalkSpeakParamsSchema = Type.Object(
  {
    text: NonEmptyString,
    voiceId: Type.Optional(Type.String()),
    modelId: Type.Optional(Type.String()),
    outputFormat: Type.Optional(Type.String()),
    speed: Type.Optional(Type.Number()),
    stability: Type.Optional(Type.Number()),
    similarity: Type.Optional(Type.Number()),
    style: Type.Optional(Type.Number()),
    speakerBoost: Type.Optional(Type.Boolean()),
    seed: Type.Optional(Type.Integer({ minimum: 0 })),
    normalize: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const talkProviderFieldSchemas = {
  voiceId: Type.Optional(Type.String()),
  voiceAliases: Type.Optional(Type.Record(Type.String(), Type.String())),
  modelId: Type.Optional(Type.String()),
  outputFormat: Type.Optional(Type.String()),
  apiKey: Type.Optional(SecretInputSchema),
};

const TalkProviderConfigSchema = Type.Object(talkProviderFieldSchemas, {
  additionalProperties: true,
});

const ResolvedTalkConfigSchema = Type.Object(
  {
    provider: Type.String(),
    config: TalkProviderConfigSchema,
  },
  { additionalProperties: false },
);

const LegacyTalkConfigSchema = Type.Object(
  {
    ...talkProviderFieldSchemas,
    interruptOnSpeech: Type.Optional(Type.Boolean()),
    silenceTimeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

const NormalizedTalkConfigSchema = Type.Object(
  {
    provider: Type.Optional(Type.String()),
    providers: Type.Optional(Type.Record(Type.String(), TalkProviderConfigSchema)),
    resolved: ResolvedTalkConfigSchema,
    ...talkProviderFieldSchemas,
    interruptOnSpeech: Type.Optional(Type.Boolean()),
    silenceTimeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const TalkConfigResultSchema = Type.Object(
  {
    config: Type.Object(
      {
        talk: Type.Optional(Type.Union([LegacyTalkConfigSchema, NormalizedTalkConfigSchema])),
        session: Type.Optional(
          Type.Object(
            {
              mainKey: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
        ui: Type.Optional(
          Type.Object(
            {
              seamColor: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const TalkSpeakResultSchema = Type.Object(
  {
    audioBase64: NonEmptyString,
    provider: NonEmptyString,
    outputFormat: Type.Optional(Type.String()),
    voiceCompatible: Type.Optional(Type.Boolean()),
    mimeType: Type.Optional(Type.String()),
    fileExtension: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsStatusParamsSchema = Type.Object(
  {
    probe: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

// Channel docking: channels.status is intentionally schema-light so new
// channels can ship without protocol updates.
export const ChannelAccountSnapshotSchema = Type.Object(
  {
    accountId: NonEmptyString,
    name: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    configured: Type.Optional(Type.Boolean()),
    linked: Type.Optional(Type.Boolean()),
    running: Type.Optional(Type.Boolean()),
    connected: Type.Optional(Type.Boolean()),
    reconnectAttempts: Type.Optional(Type.Integer({ minimum: 0 })),
    lastConnectedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastError: Type.Optional(Type.String()),
    healthState: Type.Optional(Type.String()),
    lastStartAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastStopAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastInboundAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastOutboundAt: Type.Optional(Type.Integer({ minimum: 0 })),
    streaming: Type.Optional(
      Type.Object(
        {
          ts: Type.Integer({ minimum: 0 }),
          surface: Type.Union([
            Type.Literal("none"),
            Type.Literal("draft_stream"),
            Type.Literal("editable_draft_stream"),
            Type.Literal("card_stream"),
          ]),
          enabled: Type.Boolean(),
          reason: Type.Union([
            Type.Literal("enabled"),
            Type.Literal("disabled_by_config"),
            Type.Literal("disabled_for_render_mode"),
            Type.Literal("disabled_for_thread_reply"),
          ]),
          chatId: Type.Optional(Type.Union([Type.String(), Type.Integer()])),
        },
        { additionalProperties: false },
      ),
    ),
    busy: Type.Optional(Type.Boolean()),
    activeRuns: Type.Optional(Type.Integer({ minimum: 0 })),
    lastRunActivityAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastProbeAt: Type.Optional(Type.Integer({ minimum: 0 })),
    mode: Type.Optional(Type.String()),
    dmPolicy: Type.Optional(Type.String()),
    allowFrom: Type.Optional(Type.Array(Type.String())),
    tokenSource: Type.Optional(Type.String()),
    botTokenSource: Type.Optional(Type.String()),
    appTokenSource: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    allowUnmentionedGroups: Type.Optional(Type.Boolean()),
    cliPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    dbPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    port: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    probe: Type.Optional(Type.Unknown()),
    audit: Type.Optional(Type.Unknown()),
    application: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

export const ChannelUiMetaSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    detailLabel: NonEmptyString,
    systemImage: Type.Optional(Type.String()),
    docsPath: Type.Optional(Type.String()),
    installNpmSpec: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelControlCapabilitiesSchema = Type.Object(
  {
    loginMode: Type.Union([Type.Literal("none"), Type.Literal("qr")]),
    actions: Type.Array(NonEmptyString),
    canReconnect: Type.Boolean(),
    canVerify: Type.Boolean(),
    canLogout: Type.Boolean(),
    canEdit: Type.Boolean(),
    canSetup: Type.Boolean(),
    multiAccount: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ChannelsSetupSurfaceParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChannelsSetupSurfaceResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    label: NonEmptyString,
    detailLabel: NonEmptyString,
    docsPath: Type.Optional(Type.String()),
    configured: Type.Boolean(),
    mode: Type.Union([Type.Literal("none"), Type.Literal("wizard"), Type.Literal("config")]),
    selectionHint: Type.Optional(Type.String()),
    quickstartScore: Type.Optional(Type.Number()),
    statusLines: Type.Array(Type.String()),
    accountIds: Type.Array(NonEmptyString),
    defaultAccountId: Type.Optional(Type.String()),
    canSetup: Type.Boolean(),
    canEdit: Type.Boolean(),
    multiAccount: Type.Boolean(),
    loginMode: Type.Union([Type.Literal("none"), Type.Literal("qr")]),
    commands: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export type ChannelsSetupSurfaceParams = Static<typeof ChannelsSetupSurfaceParamsSchema>;
export type ChannelsSetupSurfaceResult = Static<typeof ChannelsSetupSurfaceResultSchema>;

export const ChannelsStatusResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    channelOrder: Type.Array(NonEmptyString),
    channelLabels: Type.Record(NonEmptyString, NonEmptyString),
    channelDetailLabels: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    channelSystemImages: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    channelMeta: Type.Optional(Type.Array(ChannelUiMetaSchema)),
    catalogOrder: Type.Optional(Type.Array(NonEmptyString)),
    catalogLabels: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    catalogDetailLabels: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    catalogSystemImages: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    catalogMeta: Type.Optional(Type.Array(ChannelUiMetaSchema)),
    channels: Type.Record(NonEmptyString, Type.Unknown()),
    channelControls: Type.Optional(Type.Record(NonEmptyString, ChannelControlCapabilitiesSchema)),
    channelAccounts: Type.Record(NonEmptyString, Type.Array(ChannelAccountSnapshotSchema)),
    channelDefaultAccountId: Type.Record(NonEmptyString, NonEmptyString),
  },
  { additionalProperties: false },
);

export const ChannelsLogoutParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountTargetParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WebLoginStartParamsSchema = Type.Object(
  {
    force: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    verbose: Type.Optional(Type.Boolean()),
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLoginStartParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
    force: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    verbose: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLoginStartResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: NonEmptyString,
    message: NonEmptyString,
    qrDataUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export const WebLoginWaitParamsSchema = Type.Object(
  {
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLoginWaitParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLoginWaitResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: NonEmptyString,
    connected: Type.Boolean(),
    message: NonEmptyString,
  },
  { additionalProperties: true },
);

export const ChannelsAccountVerifyParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsAccountVerifyResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: NonEmptyString,
    verifiedAt: Type.Integer({ minimum: 0 }),
    snapshot: ChannelAccountSnapshotSchema,
    probe: Type.Optional(Type.Unknown()),
    audit: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountReconnectParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsAccountReconnectResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: NonEmptyString,
    restartedAt: Type.Integer({ minimum: 0 }),
    snapshot: Type.Optional(ChannelAccountSnapshotSchema),
  },
  { additionalProperties: false },
);

export const ChannelsConfigTargetParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChannelsConfigIssueSchema = Type.Object(
  {
    path: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export const ChannelsConfigSnapshotSchema = Type.Object(
  {
    channel: NonEmptyString,
    path: NonEmptyString,
    exists: Type.Optional(Type.Boolean()),
    hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    valid: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    config: Type.Optional(Type.Unknown()),
    issues: Type.Optional(Type.Array(ChannelsConfigIssueSchema)),
  },
  { additionalProperties: false },
);

export const ChannelsConfigSchemaResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    path: NonEmptyString,
    schema: Type.Unknown(),
    uiHints: Type.Record(Type.String(), ConfigUiHintSchema),
    version: NonEmptyString,
    generatedAt: NonEmptyString,
  },
  { additionalProperties: false },
);

const ChannelsConfigApplyLikeParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    raw: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsConfigGetParamsSchema = ChannelsConfigTargetParamsSchema;
export const ChannelsConfigSchemaParamsSchema = ChannelsConfigTargetParamsSchema;
export const ChannelsConfigPatchParamsSchema = ChannelsConfigApplyLikeParamsSchema;
export const ChannelsConfigApplyParamsSchema = ChannelsConfigApplyLikeParamsSchema;

export const ChannelsConfigWriteResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    noop: Type.Optional(Type.Boolean()),
    channel: NonEmptyString,
    path: NonEmptyString,
    config: Type.Unknown(),
    restart: Type.Optional(Type.Unknown()),
    sentinel: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const ChannelsCatalogParamsSchema = Type.Object({}, { additionalProperties: false });

export const ChannelsCatalogResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    entries: Type.Array(ChannelUiMetaSchema),
  },
  { additionalProperties: false },
);

export const ChannelsEditorGetParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChannelsEditorGetResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    setup: ChannelsSetupSurfaceResultSchema,
    config: Type.Optional(ChannelsConfigSnapshotSchema),
    schema: Type.Optional(ChannelsConfigSchemaResultSchema),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLogoutParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsAccountLogoutResultSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: NonEmptyString,
    cleared: Type.Boolean(),
  },
  { additionalProperties: true },
);
