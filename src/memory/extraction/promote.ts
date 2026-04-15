import type { ExtractedNode } from "./extractor.ts";

const ACTION_SKILL_HINTS = [
  'fix-',
  'restart-',
  'install-',
  'configure-',
  'repair-',
  'restore-',
  'setup-',
  'create-',
  'update-',
];

export function promoteTaskLikeSkills(nodes: ExtractedNode[]): ExtractedNode[] {
  return nodes.map((node) => {
    if (node.type !== 'TASK') {return node;}
    const lowerName = node.name.toLowerCase();
    const looksLikeReusableAction = ACTION_SKILL_HINTS.some((hint) => lowerName.startsWith(hint));
    const looksOperational = /步骤|执行|重启|修复|安装|配置|恢复|restart|fix|install|configure|restore/i.test(`${node.description}\n${node.content}`);
    if (!looksLikeReusableAction && !looksOperational) {return node;}
    return {
      ...node,
      type: 'PROCEDURE',
      memoryKind: "procedure",
      description: node.description || `${node.name} reusable operational skill`,
      content: node.content || `[${node.name}]\n说明: ${node.description || node.name}`,
    };
  });
}
