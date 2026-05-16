export type SecurityAuditFinding = {
  severity: "critical" | "warn" | "info";
  title: string;
  detail: string;
  remediation?: string;
};

export type SecurityAuditResult = {
  summary: { critical: number; warn: number; info: number };
  findings: SecurityAuditFinding[];
};

export function runSecurityAudit(_opts: unknown): SecurityAuditResult {
  return {
    summary: { critical: 0, warn: 0, info: 0 },
    findings: [],
  };
}
