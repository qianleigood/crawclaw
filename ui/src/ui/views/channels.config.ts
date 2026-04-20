import { html } from "lit";
import type { ConfigUiHints } from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { resolveChannelConfigValue } from "./channel-config-extras.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { hintForPath } from "./config-form.shared.ts";
import { humanize, pathKey } from "./config-form.shared.ts";
import { analyzeConfigSchema, renderNode, schemaType, type JsonSchema } from "./config-form.ts";

type ChannelConfigFormProps = {
  channelId: string;
  configValue: Record<string, unknown> | null;
  schema: unknown;
  uiHints: ConfigUiHints;
  disabled: boolean;
  onPatch: (path: Array<string | number>, value: unknown) => void;
  scoped?: boolean;
};

function resolveSchemaNode(
  schema: JsonSchema | null,
  path: Array<string | number>,
): JsonSchema | null {
  let current = schema;
  for (const key of path) {
    if (!current) {
      return null;
    }
    const type = schemaType(current);
    if (type === "object") {
      const properties = current.properties ?? {};
      if (typeof key === "string" && properties[key]) {
        current = properties[key];
        continue;
      }
      const additional = current.additionalProperties;
      if (typeof key === "string" && additional && typeof additional === "object") {
        current = additional;
        continue;
      }
      return null;
    }
    if (type === "array") {
      if (typeof key !== "number") {
        return null;
      }
      const items = Array.isArray(current.items) ? current.items[0] : current.items;
      current = items ?? null;
      continue;
    }
    return null;
  }
  return current;
}

function resolveChannelValue(
  config: Record<string, unknown>,
  channelId: string,
): Record<string, unknown> {
  return resolveChannelConfigValue(config, channelId) ?? {};
}

const EXTRA_CHANNEL_FIELDS = ["groupPolicy", "streamMode", "dmPolicy"] as const;

type ChannelConfigSectionKey = "basic" | "auth" | "accounts" | "behavior" | "advanced";

type ChannelConfigEntry = {
  key: string;
  schema: JsonSchema;
  value: unknown;
  complex: boolean;
  section: ChannelConfigSectionKey;
  order: number;
  unsupported: boolean;
};

const CHANNEL_SECTION_STEP: Record<ChannelConfigSectionKey, string> = {
  basic: "01",
  auth: "02",
  accounts: "03",
  behavior: "04",
  advanced: "05",
};

const CHANNEL_CONFIG_SECTION_COPY_KEYS: Record<
  ChannelConfigSectionKey,
  { title: string; hint: string; collapsible?: boolean }
> = {
  basic: {
    title: "基础设置",
    hint: "先填写让这个渠道能上线的必要字段。",
  },
  auth: {
    title: "登录与凭据",
    hint: "把 token、secret、应用 ID 或 cookie 路径填在这里。",
  },
  accounts: {
    title: "账号与目标位置",
    hint: "在这里新增账号、设置默认账号，并填写目标会话或房间。",
  },
  behavior: {
    title: "回复与行为",
    hint: "这里调整流式回复、群组提及，以及消息发出后的行为。",
  },
  advanced: {
    title: "高级选项（可选）",
    hint: "如果你不确定，不要动这里。只有明确知道某个渠道专用设置需要修改时再打开。",
    collapsible: true,
  },
};

function getChannelConfigSectionCopy(key: ChannelConfigSectionKey): {
  title: string;
  hint: string;
  collapsible?: boolean;
} {
  const copy = CHANNEL_CONFIG_SECTION_COPY_KEYS[key];
  return {
    title: uiLiteral(copy.title),
    hint: uiLiteral(copy.hint),
    ...(copy.collapsible ? { collapsible: true } : {}),
  };
}

const BASIC_FIELD_ORDER = new Map(
  ["enabled", "mode", "baseUrl", "endpoint", "webhookUrl", "host", "port", "path"].map(
    (key, index) => [key, index] as const,
  ),
);

const FEISHU_SECTION_ORDER: Record<ChannelConfigSectionKey, string[]> = {
  basic: ["enabled"],
  auth: ["appId", "appSecret", "encryptKey", "verificationToken"],
  accounts: ["accounts", "defaultAccount"],
  behavior: [
    "stream",
    "maxDelayMs",
    "minDelayMs",
    "dmHistoryLimit",
    "dmPolicy",
    "groupPolicy",
    "historyLimit",
    "mode",
    "tableMode",
    "replyInThread",
    "requireMention",
    "typingIndicator",
  ],
  advanced: [],
};

const AUTH_FIELD_PATTERN =
  /(token|secret|password|clientid|clientsecret|appid|appsecret|accesskey|apikey|verify|signing|credential|cookie|auth|refresh|username|email|tenant|key$)/i;
const ACCOUNT_FIELD_PATTERN =
  /(^accounts?$|defaultaccount|accountid|workspace|channelid|chatid|roomid|guildid|threadid|target|peer|phone|business|teamid|server|instance|botusername|userid)/i;
const BEHAVIOR_FIELD_PATTERN =
  /(stream|policy|reply|broadcast|typing|presence|command|mention|markdown|format|parse|history|dedupe|retry|interval|poll)/i;

function resolveSectionFromGroup(groupRaw: string | undefined): ChannelConfigSectionKey | null {
  const group = groupRaw?.trim().toLowerCase();
  if (!group) {
    return null;
  }
  if (
    group.includes("auth") ||
    group.includes("secret") ||
    group.includes("token") ||
    group.includes("credential")
  ) {
    return "auth";
  }
  if (
    group.includes("account") ||
    group.includes("routing") ||
    group.includes("target") ||
    group.includes("destination")
  ) {
    return "accounts";
  }
  if (
    group.includes("behavior") ||
    group.includes("reply") ||
    group.includes("delivery") ||
    group.includes("message")
  ) {
    return "behavior";
  }
  if (group.includes("advanced")) {
    return "advanced";
  }
  if (group.includes("basic") || group.includes("setup")) {
    return "basic";
  }
  return null;
}

function classifyChannelField(params: {
  key: string;
  schema: JsonSchema;
  hints: ConfigUiHints;
}): ChannelConfigSectionKey {
  const hint = hintForPath([params.key], params.hints);
  if (hint?.advanced) {
    return "advanced";
  }
  const grouped = resolveSectionFromGroup(hint?.group);
  if (grouped) {
    return grouped;
  }
  if (params.key === "enabled" || BASIC_FIELD_ORDER.has(params.key)) {
    return "basic";
  }
  if (params.key === "accounts") {
    return "accounts";
  }
  if (EXTRA_CHANNEL_FIELDS.includes(params.key as (typeof EXTRA_CHANNEL_FIELDS)[number])) {
    return "behavior";
  }
  if (AUTH_FIELD_PATTERN.test(params.key)) {
    return "auth";
  }
  if (ACCOUNT_FIELD_PATTERN.test(params.key)) {
    return "accounts";
  }
  if (BEHAVIOR_FIELD_PATTERN.test(params.key)) {
    return "behavior";
  }
  const type = schemaType(params.schema);
  if (type === "boolean" && (params.key.startsWith("enable") || params.key.endsWith("Enabled"))) {
    return "basic";
  }
  return "advanced";
}

function resolveFieldOrder(key: string, hints: ConfigUiHints): number {
  const hintOrder = hintForPath([key], hints)?.order;
  if (typeof hintOrder === "number") {
    return hintOrder;
  }
  return BASIC_FIELD_ORDER.get(key) ?? 100;
}

function collectChannelEntries(params: {
  channelId: string;
  schema: JsonSchema;
  value: Record<string, unknown>;
  hints: ConfigUiHints;
  basePath: Array<string | number>;
}): ChannelConfigEntry[] {
  const sectionOrder =
    params.channelId === "feishu"
      ? Object.entries(FEISHU_SECTION_ORDER).flatMap(([section, keys]) =>
          keys.map((key, index) => [`${section}:${key}`, index] as const),
        )
      : [];
  const preferredFieldOrder = new Map(sectionOrder);
  const properties = params.schema.properties ?? {};
  return Object.entries(properties)
    .map(([key, schema]) => {
      const type = schemaType(schema);
      const section = classifyChannelField({ key, schema, hints: params.hints });
      const preferredOrder = preferredFieldOrder.get(`${section}:${key}`);
      return {
        key,
        schema,
        value: params.value[key],
        complex: type === "object" || type === "array",
        section,
        order:
          typeof preferredOrder === "number"
            ? preferredOrder
            : resolveFieldOrder(key, params.hints) + (params.channelId === "feishu" ? 100 : 0),
        unsupported: false,
      } satisfies ChannelConfigEntry;
    })
    .toSorted((left, right) => {
      if (left.section !== right.section) {
        return left.section.localeCompare(right.section);
      }
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.key.localeCompare(right.key);
    });
}

function markUnsupportedEntries(
  entries: ChannelConfigEntry[],
  basePath: Array<string | number>,
  unsupported: Set<string>,
): ChannelConfigEntry[] {
  return entries.map((entry) => ({
    ...entry,
    unsupported: unsupported.has(pathKey([...basePath, entry.key])),
  }));
}

function renderUnsupportedFieldCard(params: {
  key: string;
  schema: JsonSchema;
  hints: ConfigUiHints;
}) {
  const hint = hintForPath([params.key], params.hints);
  const meta = {
    label: uiLiteral(hint?.label ?? params.schema.title ?? humanize(params.key)),
    help: hint?.help
      ? uiLiteral(hint.help)
      : params.schema.description
        ? uiLiteral(params.schema.description)
        : undefined,
  };
  return html`
    <div class="cp-channel-config-note">
      <div>
        <strong>${meta.label}</strong>
        <p>
          ${meta.help ??
          uiLiteral("这个字段结构较复杂。当前编辑页先不在这里展开，必要时再切到原始模式处理。")}
        </p>
      </div>
      <span>${uiLiteral("复杂字段")}</span>
    </div>
  `;
}

function renderChannelConfigSectionGroup(params: {
  sectionKey: ChannelConfigSectionKey;
  title: string;
  hint: string;
  entries: ChannelConfigEntry[];
  basePath: Array<string | number>;
  hints: ConfigUiHints;
  unsupported: Set<string>;
  disabled: boolean;
  onPatch: (path: Array<string | number>, value: unknown) => void;
}) {
  if (params.entries.length === 0) {
    return null;
  }
  return html`
    <section class="cp-channel-config-section">
      <div class="cp-channel-config-section__head">
        <span class="cp-channel-config-section__step"
          >${CHANNEL_SECTION_STEP[params.sectionKey]}</span
        >
        <h4>${params.title}</h4>
        <p>${params.hint}</p>
      </div>
      <div class="cp-channel-config-section__grid">
        ${params.entries.map((entry) => {
          const path = [...params.basePath, entry.key];
          return html`
            <div class=${`cp-channel-config-field ${entry.complex ? "is-wide" : ""}`.trim()}>
              ${entry.unsupported
                ? renderUnsupportedFieldCard({
                    key: entry.key,
                    schema: entry.schema,
                    hints: params.hints,
                  })
                : renderNode({
                    schema: entry.schema,
                    value: entry.value,
                    path,
                    hints: params.hints,
                    unsupported: params.unsupported,
                    disabled: params.disabled,
                    showLabel: true,
                    onPatch: params.onPatch,
                  })}
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

export function renderChannelConfigForm(props: ChannelConfigFormProps) {
  const analysis = analyzeConfigSchema(props.schema);
  const normalized = analysis.schema;
  if (!normalized) {
    return html` <div class="callout danger">${uiLiteral("Schema unavailable. Use Raw.")}</div> `;
  }
  const scoped = props.scoped === true;
  const node = scoped ? normalized : resolveSchemaNode(normalized, ["channels", props.channelId]);
  if (!node) {
    return html`
      <div class="callout danger">${uiLiteral("Channel config schema unavailable.")}</div>
    `;
  }
  const configValue = props.configValue ?? {};
  const value = scoped ? configValue : resolveChannelValue(configValue, props.channelId);
  if (schemaType(node) !== "object" || !node.properties) {
    return html`
      <div class="cp-channel-config-editor">
        <section class="cp-channel-config-section">
          <div class="cp-channel-config-section__head">
            <h4>${uiLiteral("Channel settings")}</h4>
            <p>${uiLiteral("This channel exposes a custom schema node. Edit it below.")}</p>
          </div>
          <div class="config-form">
            ${renderNode({
              schema: node,
              value,
              path: scoped ? [] : ["channels", props.channelId],
              hints: props.uiHints,
              unsupported: new Set(analysis.unsupportedPaths),
              disabled: props.disabled,
              showLabel: false,
              onPatch: props.onPatch,
            })}
          </div>
        </section>
      </div>
    `;
  }
  const basePath = scoped ? [] : ["channels", props.channelId];
  const entries = collectChannelEntries({
    channelId: props.channelId,
    schema: node,
    value,
    hints: props.uiHints,
    basePath,
  });
  const unsupported = new Set(analysis.unsupportedPaths);
  const markedEntries = markUnsupportedEntries(entries, basePath, unsupported);
  const bySection = {
    basic: markedEntries.filter((entry) => entry.section === "basic"),
    auth: markedEntries.filter((entry) => entry.section === "auth"),
    accounts: markedEntries.filter((entry) => entry.section === "accounts"),
    behavior: markedEntries.filter((entry) => entry.section === "behavior"),
    advanced: markedEntries.filter((entry) => entry.section === "advanced"),
  } satisfies Record<ChannelConfigSectionKey, ChannelConfigEntry[]>;
  const basicCopy = getChannelConfigSectionCopy("basic");
  const authCopy = getChannelConfigSectionCopy("auth");
  const accountsCopy = getChannelConfigSectionCopy("accounts");
  const behaviorCopy = getChannelConfigSectionCopy("behavior");
  const advancedCopy = getChannelConfigSectionCopy("advanced");
  return html`
    <div class="cp-channel-config-editor">
      ${renderChannelConfigSectionGroup({
        sectionKey: "basic",
        ...basicCopy,
        entries: bySection.basic,
        basePath,
        hints: props.uiHints,
        unsupported,
        disabled: props.disabled,
        onPatch: props.onPatch,
      })}
      ${renderChannelConfigSectionGroup({
        sectionKey: "auth",
        ...authCopy,
        entries: bySection.auth,
        basePath,
        hints: props.uiHints,
        unsupported,
        disabled: props.disabled,
        onPatch: props.onPatch,
      })}
      ${renderChannelConfigSectionGroup({
        sectionKey: "accounts",
        ...accountsCopy,
        entries: bySection.accounts,
        basePath,
        hints: props.uiHints,
        unsupported,
        disabled: props.disabled,
        onPatch: props.onPatch,
      })}
      ${renderChannelConfigSectionGroup({
        sectionKey: "behavior",
        ...behaviorCopy,
        entries: bySection.behavior,
        basePath,
        hints: props.uiHints,
        unsupported,
        disabled: props.disabled,
        onPatch: props.onPatch,
      })}
      ${bySection.advanced.length
        ? html`
            <details class="cp-channel-config-section cp-channel-config-section--advanced">
              <summary>${advancedCopy.title}</summary>
              <div class="cp-channel-config-section__head">
                <p>${advancedCopy.hint}</p>
              </div>
              <div class="cp-channel-config-section__grid">
                ${bySection.advanced.map((entry) => {
                  const path = [...basePath, entry.key];
                  return html`
                    <div
                      class=${`cp-channel-config-field ${entry.complex ? "is-wide" : ""}`.trim()}
                    >
                      ${renderNode({
                        schema: entry.schema,
                        value: entry.value,
                        path,
                        hints: props.uiHints,
                        unsupported,
                        disabled: props.disabled,
                        showLabel: true,
                        onPatch: props.onPatch,
                      })}
                    </div>
                  `;
                })}
              </div>
            </details>
          `
        : null}
    </div>
  `;
}

export function renderChannelConfigSection(params: { channelId: string; props: ChannelsProps }) {
  const { channelId, props } = params;
  const disabled = props.configSaving || props.configSchemaLoading;
  return html`
    <div style="margin-top: 16px;">
      ${props.configSchemaLoading
        ? html` <div class="muted">${uiLiteral("Loading config schema…")}</div> `
        : renderChannelConfigForm({
            channelId,
            configValue: props.configForm,
            schema: props.configSchema,
            uiHints: props.configUiHints,
            disabled,
            onPatch: props.onConfigPatch,
          })}
      <div class="row" style="margin-top: 12px;">
        <button
          class="btn primary"
          ?disabled=${disabled || !props.configFormDirty}
          @click=${() => props.onConfigSave()}
        >
          ${props.configSaving ? uiLiteral("Saving…") : uiLiteral("Save")}
        </button>
        <button class="btn" ?disabled=${disabled} @click=${() => props.onConfigReload()}>
          ${uiLiteral("Reload")}
        </button>
      </div>
    </div>
  `;
}
