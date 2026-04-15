import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderSkills, type SkillsProps } from "./skills.ts";

function createSkillsProps(overrides: Partial<SkillsProps> = {}): SkillsProps {
  return {
    onboarding: false,
    onboardingProgress: null,
    connected: true,
    loading: false,
    report: {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/workspace/skills",
      skills: [
        {
          name: "coding-agent",
          description: "Delegate coding tasks to the default coding agent.",
          source: "crawclaw-bundled",
          filePath: "/tmp/workspace/skills/coding-agent/SKILL.md",
          baseDir: "/tmp/workspace/skills/coding-agent",
          skillKey: "coding-agent",
          bundled: true,
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          requirements: { bins: [], env: [], config: [], os: [] },
          missing: { bins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [],
        },
        {
          name: "openai-whisper",
          description: "Transcribe audio after you add the right environment.",
          source: "workspace",
          filePath: "/tmp/workspace/skills/openai-whisper/SKILL.md",
          baseDir: "/tmp/workspace/skills/openai-whisper",
          skillKey: "openai-whisper",
          bundled: false,
          primaryEnv: "OPENAI_API_KEY",
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: false,
          requirements: { bins: [], env: ["OPENAI_API_KEY"], config: [], os: [] },
          missing: { bins: [], env: ["OPENAI_API_KEY"], config: [], os: [] },
          configChecks: [],
          install: [],
        },
        {
          name: "weather",
          description: "Disabled optional skill.",
          source: "workspace",
          filePath: "/tmp/workspace/skills/weather/SKILL.md",
          baseDir: "/tmp/workspace/skills/weather",
          skillKey: "weather",
          bundled: false,
          always: false,
          disabled: true,
          blockedByAllowlist: false,
          eligible: false,
          requirements: { bins: [], env: [], config: [], os: [] },
          missing: { bins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [],
        },
      ],
    },
    error: null,
    filter: "",
    statusFilter: "all",
    edits: {},
    busyKey: null,
    messages: {},
    detailKey: null,
    onFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onRefresh: () => undefined,
    onToggle: () => undefined,
    onEdit: () => undefined,
    onSaveKey: () => undefined,
    onInstall: () => undefined,
    onDetailOpen: () => undefined,
    onDetailClose: () => undefined,
    onNavigate: () => undefined,
    onResumeOnboarding: () => undefined,
    onRestartOnboarding: () => undefined,
    ...overrides,
  };
}

describe("skills center (browser)", () => {
  it("renders the new bucketed skills center layout", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderSkills(createSkillsProps()), container);
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Skills Center");
    expect(text).toContain("Recommended core skills");
    expect(text).toContain("Needs setup");
    expect(text).toContain("Optional and off");
    container.remove();
  });

  it("shows the onboarding setup banner when guided mode is enabled", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderSkills(
        createSkillsProps({
          onboarding: true,
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/workspace/skills",
            skills: [
              {
                name: "coding-agent",
                description: "Delegate coding tasks to the default coding agent.",
                source: "crawclaw-bundled",
                filePath: "/tmp/workspace/skills/coding-agent/SKILL.md",
                baseDir: "/tmp/workspace/skills/coding-agent",
                skillKey: "coding-agent",
                bundled: true,
                always: false,
                disabled: false,
                blockedByAllowlist: false,
                eligible: true,
                requirements: { bins: [], env: [], config: [], os: [] },
                missing: { bins: [], env: [], config: [], os: [] },
                configChecks: [],
                install: [],
              },
              {
                name: "openai-whisper",
                description: "Transcribe audio after you add the right environment.",
                source: "crawclaw-bundled",
                filePath: "/tmp/workspace/skills/openai-whisper/SKILL.md",
                baseDir: "/tmp/workspace/skills/openai-whisper",
                skillKey: "openai-whisper",
                bundled: true,
                primaryEnv: "OPENAI_API_KEY",
                always: false,
                disabled: false,
                blockedByAllowlist: false,
                eligible: false,
                requirements: { bins: [], env: ["OPENAI_API_KEY"], config: [], os: [] },
                missing: { bins: [], env: ["OPENAI_API_KEY"], config: [], os: [] },
                configChecks: [],
                install: [],
              },
            ],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Guided setup");
    expect(text).toContain("Step 4 of 5");
    expect(text).toContain("Core ready");
    container.remove();
  });

  it("opens the skill detail dialog from a skill card", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let detailKey: string | null = null;
    const renderView = () =>
      render(
        renderSkills(
          createSkillsProps({
            detailKey,
            onDetailOpen: (skillKey) => {
              detailKey = skillKey;
              renderView();
            },
            onDetailClose: () => {
              detailKey = null;
              renderView();
            },
          }),
        ),
        container,
      );

    renderView();
    await Promise.resolve();

    const skillCard = container.querySelector(".list-item-clickable");
    expect(skillCard).not.toBeNull();
    skillCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    const dialog = container.querySelector("dialog");
    expect(dialog?.textContent ?? "").toContain("coding-agent");
    expect(dialog?.textContent ?? "").toContain("eligible");
    expect(dialog?.textContent ?? "").toContain("Source: crawclaw-bundled");
    container.remove();
  });

  it("shows resume controls when onboarding is paused", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderSkills(
        createSkillsProps({
          onboarding: false,
          onboardingProgress: {
            mode: "paused",
            completedAt: { gateway: 1, agent: 2 },
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Guided setup paused");
    expect(text).toContain("Resume guided setup");
    container.remove();
  });
});
