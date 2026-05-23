export type ReplyMode = '简洁' | '标准' | '详细'

export const replyModeOptions: ReplyMode[] = ['标准', '简洁', '详细']

export function normalizeReplyMode(value: string | undefined): ReplyMode {
  switch (value?.trim()) {
    case '简洁':
    case '更快':
    case 'compact':
    case 'concise':
    case 'off':
      return '简洁'
    case '详细':
    case '更稳':
    case 'detailed':
    case 'verbose':
    case 'full':
      return '详细'
    case '标准':
    case 'standard':
    case 'balanced':
    case 'normal':
    case 'on':
    default:
      return '标准'
  }
}

export function replyModeLabel(language: 'zh-CN' | 'en', value: string | undefined): string {
  const mode = normalizeReplyMode(value)
  if (language === 'en') {
    return {
      简洁: 'Compact',
      标准: 'Standard',
      详细: 'Detailed',
    }[mode]
  }

  return mode
}
