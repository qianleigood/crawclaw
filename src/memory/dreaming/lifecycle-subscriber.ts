import type { RunLoopLifecycleEvent } from "../../agents/runtime/lifecycle/types.js";
import {
  createRunLoopLifecycleRegistration,
  createSharedLifecycleSubscriberAccessor,
} from "../../agents/special/runtime/lifecycle-subscriber.js";
import { resolveSpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import type { AutoDreamScheduler } from "./auto-dream.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

type AutoDreamLifecycleSubscriberParams = {
  scheduler: AutoDreamScheduler;
  logger: RuntimeLogger;
};

export class AutoDreamLifecycleSubscriber {
  private scheduler: AutoDreamScheduler;
  private logger: RuntimeLogger;
  private readonly handler = (event: RunLoopLifecycleEvent) => this.handleEvent(event);
  private readonly registration = createRunLoopLifecycleRegistration({
    phases: ["stop"],
    handler: this.handler,
  });

  constructor(params: AutoDreamLifecycleSubscriberParams) {
    this.scheduler = params.scheduler;
    this.logger = params.logger;
  }

  reconfigure(params: AutoDreamLifecycleSubscriberParams): void {
    this.scheduler = params.scheduler;
    this.logger = params.logger;
  }

  ensureRegistered(): void {
    this.registration.ensureRegistered();
  }

  dispose(): void {
    this.registration.dispose();
  }

  private async handleEvent(event: RunLoopLifecycleEvent): Promise<void> {
    if (event.phase !== "stop") {
      return;
    }
    const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
    const sessionFile = typeof event.sessionFile === "string" ? event.sessionFile.trim() : "";
    if (!sessionKey || isSubagentSessionKey(sessionKey)) {
      return;
    }
    if (!sessionFile) {
      return;
    }
    const parentForkContext = resolveSpecialAgentParentForkContext(
      event.metadata?.parentForkContext,
    );
    const parentRunId =
      parentForkContext?.parentRunId ||
      (typeof event.runId === "string" && event.runId.trim() ? event.runId.trim() : undefined);
    try {
      this.scheduler.submitTurn({
        sessionId: event.sessionId,
        sessionKey,
        sessionFile,
        workspaceDir:
          typeof event.metadata?.workspaceDir === "string" && event.metadata.workspaceDir.trim()
            ? event.metadata.workspaceDir.trim()
            : process.cwd(),
        runtimeContext: {
          agentId: typeof event.agentId === "string" ? event.agentId : undefined,
          ...(typeof event.metadata?.messageChannel === "string" &&
          event.metadata.messageChannel.trim()
            ? { messageChannel: event.metadata.messageChannel.trim() }
            : {}),
          ...(typeof event.metadata?.senderId === "string" && event.metadata.senderId.trim()
            ? { senderId: event.metadata.senderId.trim() }
            : {}),
          ...(parentForkContext ? { parentForkContext } : {}),
          observation: event.observation,
          ...(!parentForkContext && parentRunId ? { parentRunId } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `[memory] auto-dream lifecycle subscriber failed sessionId=${event.sessionId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const sharedAutoDreamLifecycleSubscriber = createSharedLifecycleSubscriberAccessor(
  (params: AutoDreamLifecycleSubscriberParams) => new AutoDreamLifecycleSubscriber(params),
);

export function getSharedAutoDreamLifecycleSubscriber(
  params: AutoDreamLifecycleSubscriberParams,
): AutoDreamLifecycleSubscriber {
  return sharedAutoDreamLifecycleSubscriber.get(params);
}

export const __testing = {
  resetSharedAutoDreamLifecycleSubscriber(): void {
    sharedAutoDreamLifecycleSubscriber.reset();
  },
};
