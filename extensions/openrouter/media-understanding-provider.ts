import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "crawclaw/plugin-sdk/media-understanding";

export const openrouterMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "openrouter",
  capabilities: ["image"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
};
