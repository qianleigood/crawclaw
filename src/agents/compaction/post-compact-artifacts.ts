export type CompactBoundaryPreservedSegment = {
  headMessageId: string;
  anchorKind: "summary_message";
  anchorIndex: number;
  tailMessageId: string;
};

export type CompactBoundaryMetadata = {
  trigger: "manual" | "auto";
  preTokens: number;
  messagesSummarized: number;
  resumedWithoutBoundary: boolean;
  preCompactDiscoveredTools?: string[];
  preservedSegment?: CompactBoundaryPreservedSegment;
};

export type CompactBoundaryArtifact = {
  type: "system";
  subtype: "compact_boundary";
  content: string;
  compactMetadata: CompactBoundaryMetadata;
};

export type CompactSummaryArtifact = {
  role: "user";
  subtype: "compact_summary";
  content: string;
  isCompactSummary: true;
  isVisibleInTranscriptOnly: true;
};

export type CompactKeptMessageRef = {
  messageId: string;
  turnIndex: number;
  role: string;
};

export type CompactPlanAttachmentArtifact = {
  type: "plan_attachment";
  title: string;
  source: "session_summary";
  content: string;
};

export type CompactPostArtifacts = {
  boundaryMarker: CompactBoundaryArtifact;
  summaryMessages: CompactSummaryArtifact[];
  messagesToKeep: CompactKeptMessageRef[];
  attachments: CompactPlanAttachmentArtifact[];
};

export type CompactPostArtifactsSummary = {
  summaryMessageCount: number;
  keptMessageCount: number;
  attachmentCount: number;
  discoveredToolsCount: number;
  hasPreservedSegment: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function extractBoundaryMarker(value: unknown): CompactBoundaryArtifact | null {
  const marker = asObject(value);
  if (!marker) {
    return null;
  }
  if (marker.type !== "system" || marker.subtype !== "compact_boundary") {
    return null;
  }
  const content = asString(marker.content);
  const compactMetadata = asObject(marker.compactMetadata);
  if (!content || !compactMetadata) {
    return null;
  }
  const trigger =
    compactMetadata.trigger === "manual" || compactMetadata.trigger === "auto"
      ? compactMetadata.trigger
      : null;
  const preTokens = asNumber(compactMetadata.preTokens);
  const messagesSummarized = asNumber(compactMetadata.messagesSummarized);
  if (!trigger || preTokens === null || messagesSummarized === null) {
    return null;
  }
  const preservedSegmentRecord = asObject(compactMetadata.preservedSegment);
  const preservedSegment =
    preservedSegmentRecord &&
    asString(preservedSegmentRecord.headMessageId) &&
    preservedSegmentRecord.anchorKind === "summary_message" &&
    asNumber(preservedSegmentRecord.anchorIndex) !== null &&
    asString(preservedSegmentRecord.tailMessageId)
      ? {
          headMessageId: preservedSegmentRecord.headMessageId as string,
          anchorKind: "summary_message" as const,
          anchorIndex: preservedSegmentRecord.anchorIndex as number,
          tailMessageId: preservedSegmentRecord.tailMessageId as string,
        }
      : undefined;
  return {
    type: "system",
    subtype: "compact_boundary",
    content,
    compactMetadata: {
      trigger,
      preTokens,
      messagesSummarized,
      resumedWithoutBoundary: compactMetadata.resumedWithoutBoundary === true,
      ...(asStringArray(compactMetadata.preCompactDiscoveredTools).length > 0
        ? { preCompactDiscoveredTools: asStringArray(compactMetadata.preCompactDiscoveredTools) }
        : {}),
      ...(preservedSegment ? { preservedSegment } : {}),
    },
  };
}

function extractSummaryMessages(value: unknown): CompactSummaryArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asObject(entry);
      if (!record) {
        return null;
      }
      const content = asString(record.content);
      if (record.role !== "user" || record.subtype !== "compact_summary" || !content) {
        return null;
      }
      return {
        role: "user" as const,
        subtype: "compact_summary" as const,
        content,
        isCompactSummary: true as const,
        isVisibleInTranscriptOnly: true as const,
      };
    })
    .filter((entry): entry is CompactSummaryArtifact => Boolean(entry));
}

function extractMessagesToKeep(value: unknown): CompactKeptMessageRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asObject(entry);
      if (!record) {
        return null;
      }
      const messageId = asString(record.messageId);
      const turnIndex = asNumber(record.turnIndex);
      const role = asString(record.role);
      if (!messageId || turnIndex === null || !role) {
        return null;
      }
      return { messageId, turnIndex, role };
    })
    .filter((entry): entry is CompactKeptMessageRef => Boolean(entry));
}

function extractAttachments(value: unknown): CompactPlanAttachmentArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asObject(entry);
      if (!record) {
        return null;
      }
      const title = asString(record.title);
      const content = asString(record.content);
      if (
        record.type !== "plan_attachment" ||
        record.source !== "session_summary" ||
        !title ||
        !content
      ) {
        return null;
      }
      return {
        type: "plan_attachment" as const,
        title,
        source: "session_summary" as const,
        content,
      };
    })
    .filter((entry): entry is CompactPlanAttachmentArtifact => Boolean(entry));
}

export function extractCompactPostArtifacts(value: unknown): CompactPostArtifacts | undefined {
  const record = asObject(value);
  if (!record) {
    return undefined;
  }
  const boundaryMarker = extractBoundaryMarker(record.boundaryMarker);
  if (!boundaryMarker) {
    return undefined;
  }
  return {
    boundaryMarker,
    summaryMessages: extractSummaryMessages(record.summaryMessages),
    messagesToKeep: extractMessagesToKeep(record.messagesToKeep),
    attachments: extractAttachments(record.attachments),
  };
}

export function summarizeCompactPostArtifacts(value: unknown): CompactPostArtifactsSummary {
  const artifacts = extractCompactPostArtifacts(value);
  if (!artifacts) {
    return {
      summaryMessageCount: 0,
      keptMessageCount: 0,
      attachmentCount: 0,
      discoveredToolsCount: 0,
      hasPreservedSegment: false,
    };
  }
  return {
    summaryMessageCount: artifacts.summaryMessages.length,
    keptMessageCount: artifacts.messagesToKeep.length,
    attachmentCount: artifacts.attachments.length,
    discoveredToolsCount:
      artifacts.boundaryMarker.compactMetadata.preCompactDiscoveredTools?.length ?? 0,
    hasPreservedSegment: Boolean(artifacts.boundaryMarker.compactMetadata.preservedSegment),
  };
}
