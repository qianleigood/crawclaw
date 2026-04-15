const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ASCII_LETTER = /[A-Za-z]/;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;
const STRUCTURAL_PUNCT = /[-*•#>`~_=+|\\/:;,.!?()[\]{}"']/;

function consumeWhile(text: string, start: number, predicate: (char: string) => boolean): number {
  let index = start;
  while (index < text.length && predicate(text[index])) {index += 1;}
  return index;
}

function estimateAsciiWordTokens(length: number): number {
  if (length <= 0) {return 0;}
  if (length <= 4) {return 1;}
  if (length <= 8) {return 2;}
  return Math.ceil(length / 4);
}

function estimateDigitTokens(length: number): number {
  if (length <= 0) {return 0;}
  return Math.max(1, Math.ceil(length / 2.5));
}

function estimatePunctuationTokens(length: number): number {
  if (length <= 0) {return 0;}
  return Math.max(1, Math.ceil(length * 0.5));
}

/**
 * Heuristic token estimate tuned for prompt assembly text.
 * Conservative by design: it slightly overestimates mixed-language and structured content
 * so prompt packing is less likely to exceed the real model budget.
 */
export function estimateTokenCount(text: string): number {
  if (!text) {return 0;}

  let tokens = 0;
  let index = 0;
  let nonEmptyLineCount = 0;
  let currentLineHasContent = false;

  while (index < text.length) {
    const char = text[index];

    if (char === "\n") {
      if (currentLineHasContent) {nonEmptyLineCount += 1;}
      currentLineHasContent = false;
      tokens += 0.2;
      index += 1;
      continue;
    }

    if (WHITESPACE.test(char)) {
      index = consumeWhile(text, index, (next) => next !== "\n" && WHITESPACE.test(next));
      tokens += 0.1;
      continue;
    }

    currentLineHasContent = true;

    if (CJK_CHAR.test(char)) {
      const next = consumeWhile(text, index, (value) => CJK_CHAR.test(value));
      tokens += next - index;
      index = next;
      continue;
    }

    if (ASCII_LETTER.test(char)) {
      const next = consumeWhile(text, index, (value) => ASCII_LETTER.test(value));
      tokens += estimateAsciiWordTokens(next - index);
      index = next;
      continue;
    }

    if (DIGIT.test(char)) {
      const next = consumeWhile(text, index, (value) => DIGIT.test(value));
      tokens += estimateDigitTokens(next - index);
      index = next;
      continue;
    }

    if (STRUCTURAL_PUNCT.test(char)) {
      const next = consumeWhile(text, index, (value) => STRUCTURAL_PUNCT.test(value));
      tokens += estimatePunctuationTokens(next - index);
      index = next;
      continue;
    }

    tokens += 1;
    index += 1;
  }

  if (currentLineHasContent) {nonEmptyLineCount += 1;}
  tokens += Math.ceil(nonEmptyLineCount * 0.15);

  return Math.max(1, Math.ceil(tokens));
}
