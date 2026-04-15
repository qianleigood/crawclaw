import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "crawclaw/plugin-sdk/media-understanding";

export const anthropicMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "anthropic",
  capabilities: ["image"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
};
