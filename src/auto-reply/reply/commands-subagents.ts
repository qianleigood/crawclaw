import type { CommandHandler } from "./commands-types.js";

export const extractMessageText = (value: string): string => value.trim();

export const handleSubagentsCommand: CommandHandler = async () => null;
