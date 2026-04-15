import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { SkillMessageMap } from "../controllers/skills.ts";
import { clampText } from "../format.ts";
import {
  countRememberedOnboardingSteps,
  isOnboardingFinished,
  type OnboardingProgress,
} from "../onboarding-progress.ts";
import { resolveSafeExternalUrl } from "../open-external-url.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

function safeExternalHref(raw?: string): string | null {
  if (!raw) {
    return null;
  }
  return resolveSafeExternalUrl(raw, window.location.href);
}

export type SkillsStatusFilter = "all" | "ready" | "needs-setup" | "disabled";

export type SkillsProps = {
  onboarding?: boolean;
  onboardingProgress?: OnboardingProgress | null;
  connected: boolean;
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  statusFilter: SkillsStatusFilter;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  detailKey: string | null;
  onFilterChange: (next: string) => void;
  onStatusFilterChange: (next: SkillsStatusFilter) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onDetailOpen: (skillKey: string) => void;
  onDetailClose: () => void;
  onNavigate: (tab: string) => void;
  onResumeOnboarding: () => void;
  onRestartOnboarding: () => void;
};

type StatusTabDef = { id: SkillsStatusFilter; label: string };

const STATUS_TABS: StatusTabDef[] = [
  { id: "all", label: "skillsPage.statusTabs.all" },
  { id: "ready", label: "skillsPage.statusTabs.ready" },
  { id: "needs-setup", label: "skillsPage.statusTabs.needsSetup" },
  { id: "disabled", label: "skillsPage.statusTabs.disabled" },
];

type SkillBucket = {
  id: string;
  label: string;
  subtitle: string;
  skills: SkillStatusEntry[];
};

function skillMatchesStatus(skill: SkillStatusEntry, status: SkillsStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "ready":
      return !skill.disabled && skill.eligible;
    case "needs-setup":
      return !skill.disabled && !skill.eligible;
    case "disabled":
      return skill.disabled;
  }
}

function skillStatusClass(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return "muted";
  }
  return skill.eligible ? "ok" : "warn";
}

export function renderSkills(props: SkillsProps) {
  const skills = props.report?.skills ?? [];

  const statusCounts: Record<SkillsStatusFilter, number> = {
    all: skills.length,
    ready: 0,
    "needs-setup": 0,
    disabled: 0,
  };
  for (const s of skills) {
    if (s.disabled) {
      statusCounts.disabled++;
    } else if (s.eligible) {
      statusCounts.ready++;
    } else {
      statusCounts["needs-setup"]++;
    }
  }

  const afterStatus =
    props.statusFilter === "all"
      ? skills
      : skills.filter((s) => skillMatchesStatus(s, props.statusFilter));

  const filter = props.filter.trim().toLowerCase();
  const filtered = filter
    ? afterStatus.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : afterStatus;
  const groups = buildSkillBuckets(filtered);

  const detailSkill = props.detailKey
    ? (skills.find((s) => s.skillKey === props.detailKey) ?? null)
    : null;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("skillsPage.title")}</div>
          <div class="card-sub">${t("skillsPage.subtitle")}</div>
        </div>
        <button
          class="btn"
          ?disabled=${props.loading || !props.connected}
          @click=${props.onRefresh}
        >
          ${props.loading ? t("skillsPage.loading") : t("common.refresh")}
        </button>
      </div>

      <div class="agent-tabs" style="margin-top: 14px;">
        ${STATUS_TABS.map(
          (tab) => html`
            <button
              class="agent-tab ${props.statusFilter === tab.id ? "active" : ""}"
              @click=${() => props.onStatusFilterChange(tab.id)}
            >
              ${t(tab.label)}<span class="agent-tab-count">${statusCounts[tab.id]}</span>
            </button>
          `,
        )}
      </div>

      <div
        class="filters"
        style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px;"
      >
        <a
          class="btn btn--sm"
          href="https://clawhub.com"
          target="_blank"
          rel="noreferrer"
          title=${t("skillsPage.browseTitle")}
          >${t("skillsPage.browse")}</a
        >
        <label class="field" style="flex: 1; min-width: 180px;">
          <input
            .value=${props.filter}
            @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
            placeholder=${t("skillsPage.searchPlaceholder")}
            autocomplete="off"
            name="skills-filter"
          />
        </label>
        <div class="muted">${t("skillsPage.shown", { count: String(filtered.length) })}</div>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}
      ${props.onboarding
        ? renderSkillsOnboardingGuide(props, skills)
        : renderSkillsOnboardingState(props)}
      ${filtered.length === 0
        ? html`
            <div class="muted" style="margin-top: 16px">
              ${!props.connected && !props.report
                ? t("skillsPage.notConnected")
                : t("skillsPage.empty")}
            </div>
          `
        : html`
            <div class="agent-skills-groups" style="margin-top: 16px;">
              ${groups.map((group) => {
                return html`
                  <details class="agent-skills-group" open>
                    <summary class="agent-skills-header">
                      <span>
                        <span>${group.label}</span>
                        <span class="agent-skills-header-sub">${group.subtitle}</span>
                      </span>
                      <span class="muted">${group.skills.length}</span>
                    </summary>
                    <div class="list skills-grid">
                      ${group.skills.map((skill) => renderSkill(skill, props))}
                    </div>
                  </details>
                `;
              })}
            </div>
          `}
    </section>

    ${detailSkill ? renderSkillDetail(detailSkill, props) : nothing}
  `;
}

function renderSkillsOnboardingState(props: SkillsProps) {
  const mode = props.onboardingProgress?.mode ?? "paused";
  if (mode === "guided") {
    return nothing;
  }
  const finished = isOnboardingFinished(props.onboardingProgress);
  return html`
    <section class="skills-guide">
      <div class="skills-guide__copy">
        <div class="skills-guide__eyebrow">
          ${mode === "completed"
            ? t("skillsPage.guideState.completeEyebrow")
            : t("skillsPage.guideState.pausedEyebrow")}
        </div>
        <div class="skills-guide__title">
          ${mode === "completed"
            ? t("skillsPage.guideState.completeTitle")
            : t("skillsPage.guideState.pausedTitle")}
        </div>
        <div class="skills-guide__summary">
          ${finished
            ? t("skillsPage.guideState.completeSummary")
            : t("skillsPage.guideState.pausedSummary")}
        </div>
      </div>
      <div class="skills-guide__actions">
        <button class="btn primary" @click=${props.onResumeOnboarding}>
          ${t("skillsPage.actions.resumeGuide")}
        </button>
        <button class="btn" @click=${props.onRestartOnboarding}>
          ${t("skillsPage.actions.restartGuide")}
        </button>
      </div>
    </section>
  `;
}

function renderSkillsOnboardingGuide(props: SkillsProps, skills: SkillStatusEntry[]) {
  const recommended = skills.filter((skill) => skill.bundled);
  const recommendedReady = recommended.filter((skill) => !skill.disabled && skill.eligible).length;
  const recommendedNeedsSetup = recommended.filter(
    (skill) => !skill.disabled && !skill.eligible,
  ).length;
  const recommendedOff = recommended.filter((skill) => skill.disabled).length;
  const rememberedCount = countRememberedOnboardingSteps(props.onboardingProgress);

  let title = t("skillsPage.guide.step4Title");
  let body = t("skillsPage.guide.step4Summary");
  let primaryLabel = t("skillsPage.actions.reviewConnectCenter");
  let primaryAction = () => props.onNavigate("channels");
  let secondaryLabel = t("skillsPage.actions.openChat");
  let secondaryAction = () => props.onNavigate("chat");

  if (!props.connected) {
    title = t("skillsPage.guide.step1Title");
    body = t("skillsPage.guide.step1Summary");
    primaryLabel = t("skillsPage.actions.openConnectCenter");
    primaryAction = () => props.onNavigate("channels");
    secondaryLabel = t("skillsPage.actions.backToOverview");
    secondaryAction = () => props.onNavigate("overview");
  } else if (recommendedNeedsSetup === 0 && recommendedOff === 0) {
    title = t("skillsPage.guide.step5Title");
    body = t("skillsPage.guide.step5Summary");
    primaryLabel = t("skillsPage.actions.openChat");
    primaryAction = () => props.onNavigate("chat");
    secondaryLabel = t("skillsPage.actions.returnToOverview");
    secondaryAction = () => props.onNavigate("overview");
  }

  return html`
    <section class="skills-guide">
      <div class="skills-guide__copy">
        <div class="skills-guide__eyebrow">${t("skillsPage.guide.eyebrow")}</div>
        <div class="skills-guide__title">${title}</div>
        <div class="skills-guide__summary">${body}</div>
      </div>
      <div class="skills-guide__metrics">
        <div>
          <span class="label">${t("skillsPage.stats.coreReady")}</span>
          <strong>${recommendedReady}/${recommended.length || 0}</strong>
        </div>
        <div>
          <span class="label">${t("skillsPage.stats.needSetup")}</span>
          <strong>${recommendedNeedsSetup}</strong>
        </div>
        <div>
          <span class="label">${t("skillsPage.stats.stillOff")}</span>
          <strong>${recommendedOff}</strong>
        </div>
        <div>
          <span class="label">${t("skillsPage.stats.remembered")}</span>
          <strong>${rememberedCount}/5</strong>
        </div>
      </div>
      <div class="skills-guide__actions">
        <button class="btn primary" @click=${primaryAction}>${primaryLabel}</button>
        <button class="btn" @click=${secondaryAction}>${secondaryLabel}</button>
      </div>
    </section>
  `;
}

function renderSkill(skill: SkillStatusEntry, props: SkillsProps) {
  const busy = props.busyKey === skill.skillKey;
  const dotClass = skillStatusClass(skill);

  return html`
    <div class="list-item list-item-clickable" @click=${() => props.onDetailOpen(skill.skillKey)}>
      <div class="list-main">
        <div class="list-title" style="display: flex; align-items: center; gap: 8px;">
          <span class="statusDot ${dotClass}"></span>
          ${skill.emoji ? html`<span>${skill.emoji}</span>` : nothing}
          <span>${skill.name}</span>
        </div>
        <div class="list-sub">${clampText(skill.description, 140)}</div>
        <div class="muted" style="font-size: 12px;">${describeSkillState(skill)}</div>
      </div>
      <div
        class="list-meta"
        style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;"
      >
        <label class="skill-toggle-wrap" @click=${(e: Event) => e.stopPropagation()}>
          <input
            type="checkbox"
            class="skill-toggle"
            .checked=${!skill.disabled}
            ?disabled=${busy}
            @change=${(e: Event) => {
              e.stopPropagation();
              props.onToggle(skill.skillKey, skill.disabled);
            }}
          />
        </label>
      </div>
    </div>
  `;
}

function buildSkillBuckets(skills: SkillStatusEntry[]): SkillBucket[] {
  const recommended: SkillStatusEntry[] = [];
  const enabled: SkillStatusEntry[] = [];
  const needsSetup: SkillStatusEntry[] = [];
  const optional: SkillStatusEntry[] = [];

  for (const skill of skills) {
    if (skill.bundled) {
      recommended.push(skill);
      continue;
    }
    if (!skill.disabled && !skill.eligible) {
      needsSetup.push(skill);
      continue;
    }
    if (!skill.disabled) {
      enabled.push(skill);
      continue;
    }
    optional.push(skill);
  }

  return [
    {
      id: "recommended",
      label: t("skillsPage.buckets.recommended"),
      subtitle: t("skillsPage.buckets.recommendedSub"),
      skills: recommended,
    },
    {
      id: "enabled",
      label: t("skillsPage.buckets.enabled"),
      subtitle: t("skillsPage.buckets.enabledSub"),
      skills: enabled,
    },
    {
      id: "needs-setup",
      label: t("skillsPage.buckets.needsSetup"),
      subtitle: t("skillsPage.buckets.needsSetupSub"),
      skills: needsSetup,
    },
    {
      id: "optional",
      label: t("skillsPage.buckets.optional"),
      subtitle: t("skillsPage.buckets.optionalSub"),
      skills: optional,
    },
  ].filter((group) => group.skills.length > 0);
}

function describeSkillState(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return t("skillsPage.state.disabled");
  }
  const missing = computeSkillMissing(skill);
  if (missing.length > 0) {
    return t("skillsPage.state.needs", { value: missing.join(", ") });
  }
  if (skill.bundled) {
    return t("skillsPage.state.core");
  }
  return t("skillsPage.state.ready");
}

function renderSkillDetail(skill: SkillStatusEntry, props: SkillsProps) {
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "crawclaw-bundled");
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const ensureModalOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.open) {
      return;
    }
    if (!el.isConnected) {
      queueMicrotask(() => ensureModalOpen(el));
      return;
    }
    const doc = el.ownerDocument;
    if (doc && !doc.contains(el)) {
      queueMicrotask(() => ensureModalOpen(el));
      return;
    }
    el.showModal();
  };

  return html`
    <dialog
      class="md-preview-dialog"
      ${ref(ensureModalOpen)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onDetailClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div
            class="md-preview-dialog__title"
            style="display: flex; align-items: center; gap: 8px;"
          >
            <span class="statusDot ${skillStatusClass(skill)}"></span>
            ${skill.emoji ? html`<span style="font-size: 18px;">${skill.emoji}</span>` : nothing}
            <span>${skill.name}</span>
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest("dialog")?.close();
            }}
          >
            ${t("common.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display: grid; gap: 16px;">
          <div>
            <div style="font-size: 14px; line-height: 1.5; color: var(--text);">
              ${skill.description}
            </div>
            ${renderSkillStatusChips({ skill, showBundledBadge })}
          </div>

          ${missing.length > 0
            ? html`
                <div
                  class="callout"
                  style="border-color: var(--warn-subtle); background: var(--warn-subtle); color: var(--warn);"
                >
                  <div style="font-weight: 600; margin-bottom: 4px;">${t("skillsPage.missingRequirements")}</div>
                  <div>${missing.join(", ")}</div>
                </div>
              `
            : nothing}
          ${reasons.length > 0
            ? html`
                <div class="muted" style="font-size: 13px;">${t("skillsPage.reason")}: ${reasons.join(", ")}</div>
              `
            : nothing}

          <div style="display: flex; align-items: center; gap: 12px;">
            <label class="skill-toggle-wrap">
              <input
                type="checkbox"
                class="skill-toggle"
                .checked=${!skill.disabled}
                ?disabled=${busy}
                @change=${() => props.onToggle(skill.skillKey, skill.disabled)}
              />
            </label>
            <span style="font-size: 13px; font-weight: 500;">
              ${skill.disabled ? t("common.disabled") : t("common.enabled")}
            </span>
            ${canInstall
              ? html`<button
                  class="btn"
                  ?disabled=${busy}
                  @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
                >
                  ${busy ? t("skillsPage.installing") : skill.install[0].label}
                </button>`
              : nothing}
          </div>

          ${message
            ? html`<div class="callout ${message.kind === "error" ? "danger" : "success"}">
                ${message.message}
              </div>`
            : nothing}
          ${skill.primaryEnv
            ? html`
                <div style="display: grid; gap: 8px;">
                  <div class="field">
                    <span
                      >${t("skillsPage.apiKey")}
                      <span class="muted" style="font-weight: normal; font-size: 0.88em;"
                        >(${skill.primaryEnv})</span
                      ></span
                    >
                    <input
                      type="password"
                      .value=${apiKey}
                      @input=${(e: Event) =>
                        props.onEdit(skill.skillKey, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  ${(() => {
                    const href = safeExternalHref(skill.homepage);
                    return href
                      ? html`<div class="muted" style="font-size: 13px;">
                          ${t("skillsPage.getKey")}
                          <a href="${href}" target="_blank" rel="noopener noreferrer"
                            >${skill.homepage}</a
                          >
                        </div>`
                      : nothing;
                  })()}
                  <button
                    class="btn primary"
                    ?disabled=${busy}
                    @click=${() => props.onSaveKey(skill.skillKey)}
                  >
                    ${t("skillsPage.saveKey")}
                  </button>
                </div>
              `
            : nothing}

          <div
            style="border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 6px; font-size: 12px; color: var(--muted);"
          >
            <div><span style="font-weight: 600;">${t("skillsPage.source")}:</span> ${skill.source}</div>
            <div style="font-family: var(--mono); word-break: break-all;">${skill.filePath}</div>
            ${(() => {
              const safeHref = safeExternalHref(skill.homepage);
              return safeHref
                ? html`<div>
                    <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
                      >${skill.homepage}</a
                    >
                  </div>`
                : nothing;
            })()}
          </div>
        </div>
      </div>
    </dialog>
  `;
}
