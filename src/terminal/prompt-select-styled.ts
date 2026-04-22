import { select } from "@clack/prompts";
import { translateActiveCliText } from "../cli/i18n/text.js";
import { stylePromptHint, stylePromptMessage } from "./prompt-style.js";

const translateOptionLabel = (label: string | undefined, fallback: unknown): string =>
  translateActiveCliText(label ?? String(fallback));

export function selectStyled<T>(params: Parameters<typeof select<T>>[0]) {
  return select({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) =>
      opt.hint === undefined
        ? { ...opt, label: translateOptionLabel(opt.label, opt.value) }
        : {
            ...opt,
            label: translateOptionLabel(opt.label, opt.value),
            hint: stylePromptHint(opt.hint),
          },
    ),
  });
}
