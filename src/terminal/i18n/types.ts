export type CliLocale = "en" | "zh-CN";

export type CliTranslations = Record<string, string>;

export type CliTranslationParams = Record<string, string | number>;

export type CliTranslator = (key: string, params?: CliTranslationParams) => string;
