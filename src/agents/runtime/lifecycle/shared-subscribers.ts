import {
  getSharedRunLoopActionFeedLifecycleSubscriber,
  __testing as actionFeedTesting,
} from "../../action-feed/lifecycle-subscriber.js";
import {
  getSharedRunLoopContextArchiveLifecycleSubscriber,
  __testing as contextArchiveTesting,
} from "../../context-archive/lifecycle-subscriber.js";
import {
  __testing as compatTesting,
  getSharedRunLoopLifecycleCompatSubscriber,
} from "./compat/subscriber.js";
import {
  getSharedRunLoopDiagnosticLifecycleSubscriber,
  __testing as diagnosticLifecycleTesting,
} from "./diagnostic-subscriber.js";
import {
  getSharedRunLoopObservationIndexLifecycleSubscriber,
  __testing as observationIndexTesting,
} from "./observation-index-subscriber.js";

export function ensureSharedRunLoopLifecycleSubscribers(): void {
  getSharedRunLoopLifecycleCompatSubscriber();
  getSharedRunLoopObservationIndexLifecycleSubscriber();
  getSharedRunLoopActionFeedLifecycleSubscriber();
  getSharedRunLoopContextArchiveLifecycleSubscriber();
  getSharedRunLoopDiagnosticLifecycleSubscriber();
}

export const __testing = {
  resetSharedRunLoopLifecycleSubscribers(): void {
    compatTesting.resetSharedRunLoopLifecycleCompatSubscriber();
    observationIndexTesting.resetSharedRunLoopObservationIndexLifecycleSubscriber();
    actionFeedTesting.resetSharedRunLoopActionFeedLifecycleSubscriber();
    contextArchiveTesting.resetSharedRunLoopContextArchiveLifecycleSubscriber();
    diagnosticLifecycleTesting.resetRunLoopDiagnosticLifecycleSubscriber();
  },
};
