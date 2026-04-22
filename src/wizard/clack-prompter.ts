import {
  autocompleteMultiselect,
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  type Option,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import {
  createCliTranslator,
  resolveCliLocaleFromRuntime,
  translateCliText,
} from "../cli/i18n/index.js";
import { createCliProgress } from "../cli/progress.js";
import { stripAnsi } from "../terminal/ansi.js";
import { note as emitNote } from "../terminal/note.js";
import { stylePromptHint, stylePromptMessage, stylePromptTitle } from "../terminal/prompt-style.js";
import { theme } from "../terminal/theme.js";
import type { WizardProgress, WizardPrompter } from "./prompts.js";
import { WizardCancelledError } from "./prompts.js";

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
    cancel(stylePromptTitle(t("wizard.cancelled")) ?? t("wizard.cancelled"));
    throw new WizardCancelledError();
  }
  return value;
}

function normalizeSearchTokens(search: string): string[] {
  return search
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildOptionSearchText<T>(option: Option<T>): string {
  const label = stripAnsi(option.label ?? "");
  const hint = stripAnsi(option.hint ?? "");
  const value = String(option.value ?? "");
  return `${label} ${hint} ${value}`.toLowerCase();
}

export function tokenizedOptionFilter<T>(search: string, option: Option<T>): boolean {
  const tokens = normalizeSearchTokens(search);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = buildOptionSearchText(option);
  return tokens.every((token) => haystack.includes(token));
}

export function createClackPrompter(): WizardPrompter {
  const locale = resolveCliLocaleFromRuntime(process.argv);
  const t = createCliTranslator(locale);
  const tr = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : translateCliText(locale, value);
  return {
    intro: async (title) => {
      const translated = tr(title) ?? title;
      intro(stylePromptTitle(translated) ?? translated);
    },
    outro: async (message) => {
      const translated = tr(message) ?? message;
      outro(stylePromptTitle(translated) ?? translated);
    },
    note: async (message, title) => {
      emitNote(tr(message) ?? message, tr(title));
    },
    select: async (params) =>
      guardCancel(
        await select({
          message: stylePromptMessage(tr(params.message) ?? params.message),
          options: params.options.map((opt) => {
            const base = { value: opt.value, label: tr(opt.label) ?? opt.label };
            const hint = tr(opt.hint);
            return hint === undefined ? base : { ...base, hint: stylePromptHint(hint) };
          }) as Option<(typeof params.options)[number]["value"]>[],
          initialValue: params.initialValue,
        }),
      ),
    multiselect: async (params) => {
      const options = params.options.map((opt) => {
        const base = { value: opt.value, label: tr(opt.label) ?? opt.label };
        const hint = tr(opt.hint);
        return hint === undefined ? base : { ...base, hint: stylePromptHint(hint) };
      }) as Option<(typeof params.options)[number]["value"]>[];

      if (params.searchable) {
        return guardCancel(
          await autocompleteMultiselect({
            message: stylePromptMessage(tr(params.message) ?? params.message),
            options,
            initialValues: params.initialValues,
            filter: tokenizedOptionFilter,
          }),
        );
      }

      return guardCancel(
        await multiselect({
          message: stylePromptMessage(tr(params.message) ?? params.message),
          options,
          initialValues: params.initialValues,
        }),
      );
    },
    text: async (params) => {
      const validate = params.validate;
      return guardCancel(
        await text({
          message: stylePromptMessage(tr(params.message) ?? params.message),
          initialValue: params.initialValue,
          placeholder: tr(params.placeholder),
          validate: validate
            ? (value) => {
                const result = validate(value ?? "");
                return typeof result === "string" ? (tr(result) ?? result) : result;
              }
            : undefined,
        }),
      );
    },
    confirm: async (params) =>
      guardCancel(
        await confirm({
          message: stylePromptMessage(tr(params.message) ?? params.message),
          initialValue: params.initialValue,
          active: t("common.confirm"),
          inactive: t("common.cancel"),
        }),
      ),
    progress: (label: string): WizardProgress => {
      const translatedLabel = tr(label) ?? label;
      const spin = spinner();
      spin.start(theme.accent(translatedLabel));
      const osc = createCliProgress({
        label: translatedLabel,
        indeterminate: true,
        enabled: true,
        fallback: "none",
      });
      return {
        update: (message) => {
          const translated = tr(message) ?? message;
          spin.message(theme.accent(translated));
          osc.setLabel(translated);
        },
        stop: (message) => {
          osc.done();
          spin.stop(message);
        },
      };
    },
  };
}
