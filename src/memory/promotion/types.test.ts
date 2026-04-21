import { describe, expect, it } from "vitest";
import {
  inferPromotionDurableMemoryType,
  inferPromotionMemoryBucket,
  projectPromotionCandidateMemoryKind,
} from "./types.ts";

describe("projectPromotionCandidateMemoryKind", () => {
  it("maps procedure candidates to procedure memory", () => {
    expect(projectPromotionCandidateMemoryKind("procedure")).toBe("procedure");
  });

  it("maps decision candidates to decision memory", () => {
    expect(projectPromotionCandidateMemoryKind("decision")).toBe("decision");
  });

  it("maps fact clusters to reference memory", () => {
    expect(projectPromotionCandidateMemoryKind("fact_cluster")).toBe("reference");
  });
});

describe("promotion memory bucket inference", () => {
  it("classifies feedback-like payloads as durable memory", () => {
    const payload = {
      kind: "fact_cluster" as const,
      memoryKind: "reference" as const,
      title: "回答风格偏好",
      summary: "用户反馈：操作类问题先给步骤，再补充原理。",
      facts: ["先给步骤", "再补充原理"],
      tags: ["feedback", "preference"],
      targetHint: "60 Preferences/answer-style.md",
    };

    expect(inferPromotionDurableMemoryType(payload)).toBe("feedback");
    expect(inferPromotionMemoryBucket(payload)).toBe("durable");
  });

  it("keeps procedure-like payloads on the knowledge side", () => {
    const payload = {
      kind: "procedure" as const,
      memoryKind: "procedure" as const,
      title: "deployment-security-checklist",
      summary: "部署前检查密钥、健康检查与回滚。",
      facts: ["检查密钥", "验证健康检查", "准备回滚"],
      tags: ["promotion", "procedure"],
      targetHint: "50 SOP/deployment-security-checklist.md",
    };

    expect(inferPromotionDurableMemoryType(payload)).toBeNull();
    expect(inferPromotionMemoryBucket(payload)).toBe("knowledge");
  });

  it("treats promotion candidates as governance-only artifacts by default", () => {
    const payload = {
      kind: "decision" as const,
      memoryKind: "decision" as const,
      title: "Gateway policy",
      summary: "Keep promotion separate from prompt-time recall.",
      facts: ["promotion remains governance-only"],
      tags: ["promotion", "governance"],
      targetHint: "40 Decisions/gateway-policy.md",
      surface: "governance_only" as const,
    };

    expect(payload.surface).toBe("governance_only");
    expect(inferPromotionMemoryBucket(payload)).toBe("knowledge");
  });
});
