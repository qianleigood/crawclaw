import type { webhook } from "@line/bot-sdk";

type EventWithSource<T extends { source?: webhook.Source }> = Omit<T, "source"> & {
  source: webhook.Source;
};

export type AudioMessage = webhook.AudioMessageContent;
export type EventSource = webhook.Source;
export type FollowEvent = EventWithSource<webhook.FollowEvent>;
export type ImageMessage = webhook.ImageMessageContent;
export type JoinEvent = EventWithSource<webhook.JoinEvent>;
export type LeaveEvent = EventWithSource<webhook.LeaveEvent>;
export type LocationMessage = webhook.LocationMessageContent;
export type MessageEvent = EventWithSource<webhook.MessageEvent>;
export type PostbackEvent = EventWithSource<webhook.PostbackEvent>;
export type StickerEventMessage = webhook.StickerMessageContent;
export type StickerMessage = webhook.StickerMessageContent;
export type TextMessage = webhook.TextMessageContent;
export type UnfollowEvent = EventWithSource<webhook.UnfollowEvent>;
export type VideoMessage = webhook.VideoMessageContent;
export type WebhookEvent =
  | MessageEvent
  | PostbackEvent
  | FollowEvent
  | UnfollowEvent
  | JoinEvent
  | LeaveEvent
  | Exclude<
      webhook.Event,
      | webhook.MessageEvent
      | webhook.PostbackEvent
      | webhook.FollowEvent
      | webhook.UnfollowEvent
      | webhook.JoinEvent
      | webhook.LeaveEvent
    >;
export type WebhookRequestBody = Omit<webhook.CallbackRequest, "events"> & {
  events: WebhookEvent[];
};
