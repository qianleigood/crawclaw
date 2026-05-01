import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { UnifiedQueryClassification } from "../types/orchestration.ts";

const STABLE_MEMORY_SKILL_CONTRACT = [
  "请把结构化上下文与技能一起使用。",
  "最近 transcript 负责当前回合连续性；session summary 主要在 compaction 时消费，不会每轮直接注入。",
  "Durable memory 用来保存未来仍然有用、但不能从当前代码、当前任务状态或当前临时上下文直接推导出来的协作信息。",
  "Durable memory 只允许四类 durable memory note：user、feedback、project、reference。",
  "user 记录用户的角色、目标、职责、知识背景和稳定偏好；feedback 记录应避免或继续沿用的协作方式；project 记录不能从代码或 git 历史直接推导的项目级背景、目标、时限和约束；reference 记录外部系统中的稳定信息入口。",
  "只有当当前回合暴露出稳定、未来仍有用的协作信息时，才写入 Durable memory。",
  "当用户明确要求“记住这个”“以后按这个来”“默认这样”时，如果内容符合 durable 边界，应立即保存，不要只口头答应。",
  "当用户明确要求记住或忘记某条 durable memory，且当前可用 scoped memory file tools 时，优先在当前回合显式调用这些工具。",
  "如果用户要求忽略或不要使用某条 durable memory，就按该条记忆不存在来处理；不要引用它、比较它，或借它继续推断。",
  "保存 durable memory 是两步过程：先维护对应的 durable memory Markdown 文件，再同步更新当前 scope 的 MEMORY.md 索引；MEMORY.md 是索引，不是正文，也不应带 frontmatter。",
  "MEMORY.md 的每条索引应尽量保持一行、约 150 个字符以内，用短 hook 指向 note 文件；不要把细节正文塞进索引。",
  "MEMORY.md 会进入记忆上下文，超过约 200 行或约 25KB 的冗长索引会降低可用性；应主动保持简短并移除过时指针。",
  "优先先读取 scoped manifest 和候选 note，再统一判断哪些 note 需要新增、更新或删除；不要在没有判断全局现状前零散写入。",
  "当用户明确要求忘记、移除、撤销某条 durable memory 时，应删除或更新对应 note，不要保留过期 guidance。",
  "Durable memory 的显式写入应以 durable memory note 为单位；title 要稳定可复用，description 要用一句话说清以后要记住什么，feedback / project 类型优先补充 Why 和 How to apply。",
  "feedback 不只记录纠错；当用户明确确认某种非显然但有效的协作方式以后应继续沿用时，也可以写成 feedback。",
  "project 类型里如果出现相对日期，要转换成绝对日期再保存，避免时间过去后失去可解释性。",
  "写入前先判断当前 scope 中是否已经有表达同一条长期信息的 durable memory note；如果有，优先更新，不要重复创建。",
  "如果当前回合没有显式写 durable memory，宿主可能在回合结束后基于最近消息和已有 durable memory 清单补写 durable memory note；这个 after-turn 补写只是兜底，不替代当前回合应做的显式写入。",
  "不要把代码模式、架构、文件路径、git 历史、调试解法、CLAUDE/CrawClaw 文档里已有的内容、当前任务进度、临时计划、短期调试状态或活动日志写入 Durable memory。",
  "凡是可以通过当前代码、git 历史、文档或运行态重新发现的内容，都不应写入 Durable memory。",
  "当记忆看起来相关、用户提到以前的协作、或用户明确要求检查 / 回忆 / 记住时，才访问 durable memory。",
  "Durable memory 是时间点观察，不是当前真相；旧记忆可能已经过时。",
  "如果 Durable memory 提到文件、函数、flag、repo 状态或代码行为，在给出建议前先用当前文件、工具或外部资源验证。",
  "如果用户即将根据某条 durable memory 采取行动，而不是只是在问历史背景，先验证再建议。",
  "如果召回记忆和当前观察冲突，信当前现实，并更新或删除过期 durable memory，而不是继续沿用旧说法。",
  "经验回忆提供的是回忆到的操作经验、决策经验、运行经验和参考资料，它们只是历史经验，不是当前真相。",
  "前台的经验回忆应来自当前配置的经验提供方，不要依赖旧的召回旁路或历史兼容回退。",
  "看起来像技能或流程的召回项只是上下文证据，不是本地 SKILL.md 文件。",
  "只有通过宿主 available_skills 目录展示出来的技能，才算可打开或可读取的本地技能。",
  "当前用户意图、最近可见消息和当前工具 / 运行时状态，优先于旧的 durable memory 或 experience recall。",
  "如果某条召回记忆会影响当前建议，先用当前文件、工具或 surfaced skills 验证，再采取行动。",
  "把运行态与经验回忆信号当作时间敏感信息，它们可能已经过时。",
].join(" ");

export function renderAgentMemoryRoutingContract(): { text: string; estimatedTokens: number } {
  return {
    text: STABLE_MEMORY_SKILL_CONTRACT,
    estimatedTokens: estimateTokenCount(STABLE_MEMORY_SKILL_CONTRACT),
  };
}

export function renderContextRoutingSection(
  classification: UnifiedQueryClassification | null | undefined,
): { text: string; estimatedTokens: number } | null {
  if (!classification) {
    return null;
  }
  const lines = [
    "## 上下文路由",
    `- 意图: ${classification.intent}`,
    `- 优先层: ${classification.targetLayers.slice(0, 2).join(", ") || "sources"}`,
  ];
  const text = lines.join("\n");
  return {
    text,
    estimatedTokens: estimateTokenCount(text),
  };
}
