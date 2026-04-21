export interface GovernanceSummary {
  maintenanceRuns: {
    total: number;
    failed: number;
    done: number;
    running: number;
  };
  executionTasks: {
    running: number;
    topKinds: Array<{ kind: string; count: number }>;
  };
  knowledgeHealth: {
    total: number;
    active: number;
    merged: number;
    deprecated: number;
    candidateValidation: number;
    validated: number;
    highConfidence: number;
    stale: number;
    lowConfidence: number;
  } | null;
  promotionHealth: {
    totalCandidates: number;
    pendingCandidates: number;
    staleCandidates: number;
    statusBreakdown: Array<{ status: string; count: number }>;
  };
  mergeAudits: {
    recentCount: number;
  };
  recallFailures: {
    recentCount: number;
  };
  durableExtraction: {
    recentCount: number;
    runCount: number;
    skipCount: number;
    topReasons: Array<{ reason: string; count: number }>;
  };
}

export interface GovernanceLifecycleRow {
  type: string | null;
  validationStatus: string;
  lifecycleStage: string;
  count: number;
}

export interface WeakKnowledgeCandidateRow {
  id: string;
  type: string | null;
  name: string | null;
  validationStatus: string | null;
  lifecycleStage: string | null;
  confidenceScore: number;
  lastValidatedAt: number | null;
  lastMaintainedAt: number | null;
  updatedAt: number | null;
}

export interface GovernanceHotspotRow {
  id: string;
  type: string | null;
  name: string | null;
  degree: number;
  pagerank: number;
}

export interface GovernanceSupersededKnowledgeRow {
  id: string;
  type: string | null;
  name: string | null;
  status: string;
  validationStatus: string | null;
  lifecycleStage: string | null;
  mergedInto: string | null;
  supersededAt: number | null;
  updatedAt: number | null;
}

export interface GovernanceConflictClusterRow {
  id: string;
  type: string | null;
  name: string | null;
  conflictCount: number;
  conflictIds: string[];
  conflictLabels: string[];
  pagerank: number;
  updatedAt: number | null;
}

export interface GovernanceMaintenanceRunRow {
  id: string;
  kind: string;
  status: string;
  summary: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface GovernanceRecallFailureRow {
  id: string;
  source: string | null;
  mode: string;
  memoryLayer: string;
  query: string;
  createdAt: number;
}

export interface GovernanceValidationEvidenceRow {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  validationStatus: string | null | undefined;
  lifecycleStage: string | null | undefined;
  validatedCount: number;
  confidenceScore?: number;
  lastValidatedAt?: number | null;
  traceRef: string;
  alignment: "aligned" | "needs_review";
  evidenceRefs: string[];
  rationale: string;
}

export interface GovernanceRecallDiagnosticRow {
  id: string;
  query: string;
  mode: string;
  memoryLayer: string;
  source: string | null;
  createdAt: number;
  analysis: {
    shape: string | null;
    effectiveTokenCount: number | null;
    estimatedClauseCount: number | null;
  } | null;
  candidateCounts: Record<string, unknown> | null;
  fallbacks: Array<Record<string, unknown>>;
  topMergedSeeds: Array<{
    id: string;
    name: string;
    score: number;
    scoreParts: Record<string, unknown> | null;
  }>;
  validationEvidence: GovernanceValidationEvidenceRow[];
}

export interface GovernanceMergeAuditRow {
  id: string;
  runId: string | null;
  canonicalNodeId: string;
  mergedNodeIdsJson: string;
  score: number | null;
  reason: string | null;
  mode: "manual" | "semi-auto" | "auto";
  createdAt: number;
}

export interface GovernanceDebugSummary {
  topRecallFallbackReasons: Array<{ reason: string; count: number }>;
  topRecallFailureQueries: Array<{ query: string; count: number }>;
  durableExtractionSkipsByReason: Array<{ reason: string; count: number }>;
  durableExtractionRunsByReason: Array<{ reason: string; count: number }>;
  weakKnowledgeByValidationStatus: Array<{ validationStatus: string; count: number }>;
}

export interface GovernanceConsistencySummary {
  totalIssues: number;
  highSeverity: number;
  byKind: Array<{ kind: string; count: number }>;
}

export interface GovernanceConsistencyIssueRow {
  id: string;
  kind: "sync_state_issue";
  severity: "low" | "medium" | "high";
  candidateId: string | null;
  notePath: string | null;
  decisionId: string | null;
  writeAuditId: string | null;
  syncStateId: string | null;
  summary: string;
  detail: string;
  createdAt: number;
  refs: string[];
}

export interface GovernanceExecutionActivityRow {
  id: string;
  activityType: "maintenance_run" | "merge_audit" | "recall_trace" | "durable_extraction_run";
  title: string;
  status: "done" | "failed" | "running" | "pending" | "cancelled" | "info";
  createdAt: number;
  summary?: string | null;
  detail?: string | null;
  refs?: string[];
}

export interface GovernanceExecutionTaskRow {
  id: string;
  name: string;
  kind: string | null;
  status: string | null;
  sourceSessionId: string | null;
  summary: string | null;
  updatedAt: number;
  artifacts: Array<{
    kind: "session" | "file" | "config";
    id: string;
    label: string;
    relation?: string | null;
  }>;
}

export interface GovernanceExecutionGraphNode {
  id: string;
  nodeType: "activity" | "task" | "artifact";
  kind: string;
  label: string;
  status?: string | null;
  createdAt?: number;
  updatedAt?: number;
  refs?: string[];
}

export interface GovernanceExecutionGraphEdge {
  fromId: string;
  toId: string;
  relation: string;
}

export interface GovernanceExecutionGraph {
  summary: {
    activityCount: number;
    taskCount: number;
    artifactCount: number;
    edgeCount: number;
  };
  nodes: GovernanceExecutionGraphNode[];
  edges: GovernanceExecutionGraphEdge[];
}

export interface MemoryGovernanceReport {
  summary: GovernanceSummary;
  lifecycleBreakdown: GovernanceLifecycleRow[];
  weakKnowledgeCandidates: WeakKnowledgeCandidateRow[];
  supersededKnowledgeCandidates: GovernanceSupersededKnowledgeRow[];
  conflictClusters: GovernanceConflictClusterRow[];
  governanceHotspots: GovernanceHotspotRow[];
  recentMaintenanceRuns: GovernanceMaintenanceRunRow[];
  recentRecallFailures: GovernanceRecallFailureRow[];
  recentRecallDiagnostics: GovernanceRecallDiagnosticRow[];
  recentMergeAudits: GovernanceMergeAuditRow[];
  executionActivity: GovernanceExecutionActivityRow[];
  executionTasks: GovernanceExecutionTaskRow[];
  executionGraph: GovernanceExecutionGraph;
  consistencySummary?: GovernanceConsistencySummary;
  consistencyIssues?: GovernanceConsistencyIssueRow[];
  debugSummary: GovernanceDebugSummary;
}

export interface GovernanceDashboardCard {
  id: string;
  title: string;
  value: number;
  unit?: string;
  subtitle?: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface GovernanceDashboardAlert {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  metric: number;
  href?: string;
}

export interface GovernanceDashboardChartSeriesItem {
  label: string;
  value: number;
  ratio?: number;
  tone?: string;
}

export interface GovernanceDashboardChart {
  id: string;
  title: string;
  chartType: "bar" | "donut" | "stacked-bar";
  series: GovernanceDashboardChartSeriesItem[];
}

export interface GovernanceDashboardTable {
  id: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  emptyState: string;
}

export interface MemoryGovernanceDashboardView {
  contractVersion: "governance-dashboard/v1";
  generatedAt: string;
  filters: {
    limit: number;
    traceLimit: number;
    weakLimit: number;
    hotspotLimit: number;
  };
  overview: {
    headline: string;
    status: "healthy" | "attention";
    cards: GovernanceDashboardCard[];
  };
  alerts: GovernanceDashboardAlert[];
  charts: GovernanceDashboardChart[];
  tables: GovernanceDashboardTable[];
  raw: {
    summary: GovernanceSummary;
    debugSummary: GovernanceDebugSummary;
    executionGraphSummary: GovernanceExecutionGraph["summary"];
  };
}
