---
read_when:
  - 你需要跨多个文件进行结构化文件编辑
  - 你想记录或调试基于补丁的编辑
summary: 使用 apply_patch 工具应用多文件补丁
title: apply_patch 工具
x-i18n:
  generated_at: "2026-06-05T14:49:32Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 28af1b432a5cefd29b6a252e9d81fd29148eab2692b2f6ee6d45cf0d95fe1684
  source_path: tools/apply-patch.md
  workflow: 15
---

# apply_patch 工具

使用结构化补丁格式应用文件更改。这非常适合多文件或多块编辑，在这种情况下，单个 `edit` 调用会显得脆弱。

该工具接受一个包含一个或多个文件操作的 `input` 字符串：

```
*** Begin Patch
*** Add File: path/to/file.txt
+line 1
+line 2
*** Update File: src/app.ts
@@
-old line
+new line
*** Delete File: obsolete.txt
*** End Patch
```

## 参数

- `input`（必需）：包含 `*** Begin Patch` 和 `*** End Patch` 的完整补丁内容。

## 注意事项

- 补丁路径支持相对路径（相对于工作区目录）和绝对路径。
- `tools.exec.applyPatch.workspaceOnly` 默认为 `true`（限制在工作区内）。仅在你有意希望 `apply_patch` 在工作区目录之外写入/删除时才将其设置为 `false`。
- 在 `*** Update File:` 块内使用 `*** Move to:` 来重命名文件。
- `*** End of File` 在需要时标记仅 EOF 插入。
- 默认情况下适用于 OpenAI 和 OpenAI Codex 模型。设置 `tools.exec.applyPatch.enabled: false` 以禁用。
- 可选择性地通过 `tools.exec.applyPatch.allowModels` 按模型进行门控。
- 配置仅在 `tools.exec` 下。

## 示例

```json
{
  "tool": "apply_patch",
  "input": "*** Begin Patch\n*** Update File: src/plugin.ts\n@@\n-const foo = 1\n+const foo = 2\n*** End Patch"
}
```
