export type CliBannerTaglineMode = "random" | "default" | "off";

export type CliConfig = {
  /** Human-facing terminal locale for prompts/help text. */
  language?: "en" | "zh-CN";
  banner?: {
    /**
     * Controls terminal banner tagline behavior.
     * - "random": pick from tagline pool (default)
     * - "default": always use DEFAULT_TAGLINE
     * - "off": hide tagline text
     */
    taglineMode?: CliBannerTaglineMode;
  };
};
