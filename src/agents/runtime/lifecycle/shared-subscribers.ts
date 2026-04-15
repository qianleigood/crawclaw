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

export function ensureSharedRunLoopLifecycleSubscribers(): void {
  getSharedRunLoopLifecycleCompatSubscriber();
  getSharedRunLoopActionFeedLifecycleSubscriber();
  getSharedRunLoopContextArchiveLifecycleSubscriber();
}

export const __testing = {
  resetSharedRunLoopLifecycleSubscribers(): void {
    compatTesting.resetSharedRunLoopLifecycleCompatSubscriber();
    actionFeedTesting.resetSharedRunLoopActionFeedLifecycleSubscriber();
    contextArchiveTesting.resetSharedRunLoopContextArchiveLifecycleSubscriber();
  },
};
