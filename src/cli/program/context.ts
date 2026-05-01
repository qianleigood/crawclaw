import { loadConfig } from "../../config/config.js";
import { VERSION } from "../../version.js";
import { resolveCliChannelOptions } from "../channel-options.js";
import { createCliTranslator, resolveCliLocale, setActiveCliLocale } from "../i18n/index.js";
import type { CliLocale, CliTranslator } from "../i18n/types.js";

export type ProgramContext = {
  programVersion: string;
  locale: CliLocale;
  t: CliTranslator;
  channelOptions: string[];
  messageChannelOptions: string;
  agentChannelOptions: string;
};

export function createProgramContext(options?: {
  argv?: readonly string[];
  configLanguage?: string;
  envLanguage?: string;
}): ProgramContext {
  let cachedChannelOptions: string[] | undefined;
  const getChannelOptions = (): string[] => {
    if (cachedChannelOptions === undefined) {
      cachedChannelOptions = resolveCliChannelOptions();
    }
    return cachedChannelOptions;
  };
  let configLanguage = options?.configLanguage;
  if (configLanguage === undefined) {
    try {
      configLanguage = loadConfig().cli?.language;
    } catch {
      configLanguage = undefined;
    }
  }
  const locale = resolveCliLocale({
    argv: options?.argv ?? process.argv,
    config: configLanguage,
    env: options?.envLanguage ?? process.env.CRAWCLAW_LANG,
    systemEnv: [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG],
  });
  setActiveCliLocale(locale);
  const t = createCliTranslator(locale);

  return {
    programVersion: VERSION,
    locale,
    t,
    get channelOptions() {
      return getChannelOptions();
    },
    get messageChannelOptions() {
      return getChannelOptions().join("|");
    },
    get agentChannelOptions() {
      return ["last", ...getChannelOptions()].join("|");
    },
  };
}
