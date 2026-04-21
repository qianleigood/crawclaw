import chalk, { Chalk } from "chalk";
import { CRAB_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(CRAB_PALETTE.accent),
  accentBright: hex(CRAB_PALETTE.accentBright),
  accentDim: hex(CRAB_PALETTE.accentDim),
  info: hex(CRAB_PALETTE.info),
  success: hex(CRAB_PALETTE.success),
  warn: hex(CRAB_PALETTE.warn),
  error: hex(CRAB_PALETTE.error),
  muted: hex(CRAB_PALETTE.muted),
  heading: baseChalk.bold.hex(CRAB_PALETTE.accent),
  command: hex(CRAB_PALETTE.accentBright),
  option: hex(CRAB_PALETTE.warn),
} as const;

export const isRich = () => baseChalk.level > 0;

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
