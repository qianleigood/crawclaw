import { getSharedRunLoopActionFeedLifecycleSubscriber } from "../../action-feed/lifecycle-subscriber.js";
import { getSharedRunLoopContextArchiveLifecycleSubscriber } from "../../context-archive/lifecycle-subscriber.js";
import { getSharedRunLoopLifecycleCompatSubscriber } from "./compat/subscriber.js";
import { getSharedRunLoopDiagnosticLifecycleSubscriber } from "./diagnostic-subscriber.js";
import { getSharedRunLoopObservationIndexLifecycleSubscriber } from "./observation-index-subscriber.js";

export function ensureSharedRunLoopLifecycleSubscribers(): void {
  getSharedRunLoopLifecycleCompatSubscriber();
  getSharedRunLoopObservationIndexLifecycleSubscriber();
  getSharedRunLoopActionFeedLifecycleSubscriber();
  getSharedRunLoopContextArchiveLifecycleSubscriber();
  getSharedRunLoopDiagnosticLifecycleSubscriber();
}
