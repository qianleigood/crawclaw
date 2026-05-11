import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('CrawClaw Desktop macOS shell', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CRAWCLAW_DESKTOP_FIXTURE', '1')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('renders the macOS-style desktop shell without backend data', () => {
    const { container } = render(<App />)

    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '思考等级 高' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模型 GPT-5.5' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '思考与价格' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '语音输入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '智能体' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自动化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记忆' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '置顶' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '对话' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '讨论群' })).toBeInTheDocument()
    expect(screen.getByText('桌面 UI 评审群')).toBeInTheDocument()
    expect(screen.getByText('Runtime 迁移讨论')).toBeInTheDocument()
    expect(container.querySelectorAll('.thread-row__avatar')).toHaveLength(4)
    expect(container.querySelectorAll('.thread-row__pin')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '取消置顶对话：检查代码文档漂移' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '置顶对话：重构桌面应用参考 Codex UI' })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('button', { name: '重构桌面应用参考 Codex UI' }))
    expect(screen.getByRole('menu', { name: '对话操作菜单' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '置顶' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '复制链接' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '归档' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '项目' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '本机工作台' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('对话工作区')).toBeInTheDocument()
    expect(container.querySelectorAll('.chat-avatar--assistant')).toHaveLength(8)
    expect(container.querySelectorAll('.chat-avatar--user')).toHaveLength(5)
    expect(screen.getAllByRole('article')).toHaveLength(8)
    expect(screen.getByText(/准备 CrawClaw 在这台 Mac 上工作/)).toBeInTheDocument()
    expect(screen.getByText(/真正的桌面对话界面/)).toBeInTheDocument()
    expect(screen.getByText(/后端先不要接/)).toBeInTheDocument()
    expect(screen.getByLabelText('多媒体消息示例')).toBeInTheDocument()
    expect(screen.getByLabelText('图片消息示例')).toBeInTheDocument()
    expect(screen.getByLabelText('视频消息示例')).toBeInTheDocument()
    expect(screen.getByLabelText('批量图片消息示例')).toBeInTheDocument()
    expect(screen.getByLabelText('图片加载中')).toBeInTheDocument()
    expect(screen.getByLabelText('视频加载中')).toBeInTheDocument()
    expect(screen.getByLabelText('批量图片加载中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开图片所在文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开视频所在文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开批量图片所在文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '播放视频' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '批量图片轮播' })).toBeInTheDocument()
    expect(container.querySelector('.batch-image-carousel')).toBeInTheDocument()
    expect(container.querySelectorAll('.batch-image-grid__tile')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '上一页批量图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页批量图片' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /批量图片第 \d 页/ })).toHaveLength(2)
    expect(screen.getByText('图片消息')).toBeInTheDocument()
    expect(screen.getByText('批量图片')).toBeInTheDocument()
    expect(screen.getByText('8 张图片')).toBeInTheDocument()
    expect(screen.queryByText('4 张图片')).not.toBeInTheDocument()
    expect(screen.getByText('视频消息')).toBeInTheDocument()
    expect(screen.getByText('分辨率 1280 x 720')).toBeInTheDocument()
    expect(screen.getByText('视频时长 00:42')).toBeInTheDocument()
    expect(screen.queryByText('界面截图 1280 x 720')).not.toBeInTheDocument()
    expect(screen.queryByText('00:42 本机录屏')).not.toBeInTheDocument()
    expect(screen.getByText('desktop-ui-notes.md')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开附件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在文件夹中显示' })).toBeInTheDocument()
    expect(screen.getByLabelText('消息生成中')).toBeInTheDocument()
    expect(screen.getByText(/工具调用、Skill 执行和语音消息/)).toBeInTheDocument()
    expect(screen.getByLabelText('工具和 Skill 调用示例')).toBeInTheDocument()
    expect(screen.getByText('工具调用')).toBeInTheDocument()
    expect(screen.getByText('desktop.inspect_ui')).toBeInTheDocument()
    expect(screen.getByText('Skill 执行')).toBeInTheDocument()
    expect(screen.getByText('macOS UI polish')).toBeInTheDocument()
    expect(screen.getByLabelText('工作流消息示例')).toBeInTheDocument()
    expect(screen.getByText('n8n 工作流')).toBeInTheDocument()
    expect(screen.getByText('线索同步与通知')).toBeInTheDocument()
    expect(screen.getByLabelText('n8n 节点状态')).toBeInTheDocument()
    expect(screen.getByLabelText('当前执行节点')).toBeInTheDocument()
    expect(screen.getAllByText('清洗数据')).toHaveLength(2)
    expect(screen.getByText('已完成 1/3')).toBeInTheDocument()
    expect(screen.queryByText('3 条输出')).not.toBeInTheDocument()
    expect(screen.getByText('ComfyUI 工作流')).toBeInTheDocument()
    expect(screen.getByText('产品图生成')).toBeInTheDocument()
    expect(screen.getByLabelText('ComfyUI 图像预览')).toBeInTheDocument()
    expect(screen.getByText('采样 18/24')).toBeInTheDocument()
    expect(screen.getByText('定时任务')).toBeInTheDocument()
    expect(screen.getByText('每日环境巡检')).toBeInTheDocument()
    expect(screen.getByLabelText('定时任务计划')).toBeInTheDocument()
    expect(screen.getByText('每天 09:30')).toBeInTheDocument()
    expect(screen.getByText('下次运行')).toBeInTheDocument()
    expect(screen.getByText('最近成功 昨天 09:31')).toBeInTheDocument()
    expect(screen.getByLabelText('语音消息示例')).toBeInTheDocument()
    expect(screen.getByText('语音消息 · 00:08')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '界面基础层已切换' })).toBeInTheDocument()
    expect(screen.getByText('Base UI 作为后续复杂控件行为层')).toBeInTheDocument()
    expect(screen.getByText('lucide 图标替换 Unicode 占位符')).toBeInTheDocument()
    expect(screen.queryByLabelText('CrawClaw desktop preview')).not.toBeInTheDocument()
    expect(screen.queryByText(/preview|image|screenshot/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('权限审核')).toBeInTheDocument()
    expect(screen.getByText(/CrawClaw 请求读取当前窗口内容/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('告诉 CrawClaw 要做什么...')).toBeInTheDocument()
    expect(screen.getByText('Desktop API')).toBeInTheDocument()
    expect(screen.getByText('Runtime')).toBeInTheDocument()
    expect(screen.getByText('missing')).toBeInTheDocument()
    expect(screen.queryByText('main')).not.toBeInTheDocument()
    expect(screen.queryByText('Runtime missing')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '权限模式 工作区模式' })).toBeInTheDocument()
    expect(screen.queryByText('本机模式')).not.toBeInTheDocument()
    expect(container.querySelector('.status-rail')).not.toBeInTheDocument()
    expect(container.querySelector('.desktop-toolbar')).not.toBeInTheDocument()
    expect(container.querySelector('.window-controls')).not.toBeInTheDocument()
  })

  it('supports animated static interactions in the composer', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: '思考等级 高' }))
    expect(screen.getByRole('menu', { name: '思考等级选择' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '中' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '思考 中' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '模型 GPT-5.5' }))
    expect(screen.getByRole('menu', { name: '模型选择' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'GPT-5.4' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '语音输入' }))
    expect(screen.getByRole('button', { name: '停止收声' })).toHaveClass('is-listening')
    expect(screen.getByLabelText('正在收声')).toHaveAttribute('data-tone', 'active')
    expect(container.querySelectorAll('.listening-meter span')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: '权限模式 工作区模式' }))
    expect(screen.getByRole('menu', { name: '权限模式选择' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '只读模式' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '工作区模式' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '完全访问' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '本机模式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '完全访问权限' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '只读模式' }))
    expect(screen.getByRole('button', { name: '权限模式 只读模式' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '允许一次' }))
    expect(screen.getByLabelText('权限审核')).toHaveClass('is-approved')
    expect(screen.getByText('已允许一次')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '允许一次' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument()

    const composer = screen.getByPlaceholderText('告诉 CrawClaw 要做什么...')
    await user.type(composer, '/')
    expect(screen.getByRole('menu', { name: '命令菜单' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '运行工作流' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '调用工具' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '创建定时任务' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '运行工作流' }))
    expect(composer).toHaveValue('/workflow ')

    await user.clear(composer)
    await user.type(composer, '@')
    expect(screen.getByRole('menu', { name: 'Skill 菜单' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'macOS UI polish' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'desktop.inspect_ui' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'macOS UI polish' }))
    expect(composer).toHaveValue('@macOS UI polish ')

    await user.clear(composer)
    await user.type(composer, '演示界面交互动效')
    await user.keyboard('{Enter}')
    expect(screen.getByText('演示界面交互动效')).toBeInTheDocument()
    expect(container.querySelector('.chat-row--draft')).toBeInTheDocument()

    await user.type(composer, '第一行{shift>}{enter}{/shift}第二行')
    expect(composer).toHaveValue('第一行\n第二行')
  })

  it('closes menus with keyboard and outside clicks', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '思考等级 高' }))
    expect(screen.getByRole('menu', { name: '思考等级选择' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: '思考等级选择' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '思考等级 高' }))
    screen.getByRole('menuitem', { name: '高' }).focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('button', { name: '思考等级 中' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '模型 GPT-5.5' }))
    expect(screen.getByRole('menu', { name: '模型选择' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('对话工作区'))
    expect(screen.queryByRole('menu', { name: '模型选择' })).not.toBeInTheDocument()
  })

  it('moves conversations between normal and pinned groups', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '置顶对话：清理文档代码和数据库' }))

    const pinnedGroup = screen.getByRole('region', { name: '置顶' })
    const threadGroup = screen.getByRole('region', { name: '对话' })
    expect(screen.getByRole('button', { name: '取消置顶对话：清理文档代码和数据库' })).toHaveClass(
      'thread-row__pin--unpin',
    )
    expect(pinnedGroup).toHaveTextContent('清理文档代码和数据库')
    expect(threadGroup).not.toHaveTextContent('清理文档代码和数据库')

    await user.click(screen.getByRole('button', { name: '取消置顶对话：清理文档代码和数据库' }))

    expect(pinnedGroup).not.toHaveTextContent('清理文档代码和数据库')
    expect(threadGroup).toHaveTextContent('清理文档代码和数据库')

    await user.click(screen.getByRole('button', { name: '取消置顶对话：检查代码文档漂移' }))
    expect(pinnedGroup).not.toHaveTextContent('检查代码文档漂移')
  })

  it('switches sidebar sections and completes context menu actions', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '智能体' }))
    expect(screen.getByRole('button', { name: '智能体' })).toHaveClass('is-active')
    expect(screen.getByRole('region', { name: '智能体 工作区' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '插件' }))
    expect(screen.getByRole('region', { name: '插件 工作区' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '自动化' }))
    expect(screen.getByRole('region', { name: '自动化 工作区' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '记忆' }))
    expect(screen.getByRole('region', { name: '记忆 工作区' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '设置' }))
    const settingsWorkspace = screen.getByRole('region', { name: '设置 工作区' })
    expect(settingsWorkspace).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '设置导航' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '设置分类' })).toBeInTheDocument()
    expect(within(settingsWorkspace).queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新对话' })).not.toBeInTheDocument()
    expect(within(settingsWorkspace).getByRole('heading', { name: '设置' })).toBeInTheDocument()
    const settingsSections = ['常规', '模型与回复', '权限与确认', '记忆偏好', '通知', '数据与隐私', '高级']
    for (const section of settingsSections) {
      expect(screen.getByRole('button', { name: section })).toBeInTheDocument()
    }
    const generalSection = within(settingsWorkspace).getByRole('region', { name: '常规' })
    expect(generalSection).toHaveClass('is-active')
    for (const section of settingsSections.filter((section) => section !== '常规')) {
      expect(within(settingsWorkspace).getByRole('region', { name: section })).not.toHaveClass('is-active')
    }
    expect(within(settingsWorkspace).queryByText('配置中心')).not.toBeInTheDocument()
    expect(within(settingsWorkspace).queryByText('让 CrawClaw 按你的方式工作')).not.toBeInTheDocument()
    expect(within(settingsWorkspace).queryByText('记忆详情')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启动时打开 CrawClaw' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: '启动时打开 CrawClaw' }))
    expect(screen.getByRole('button', { name: '启动时打开 CrawClaw' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '模型与回复' }))
    const modelSection = within(settingsWorkspace).getByRole('region', { name: '模型与回复' })
    expect(modelSection).toHaveClass('is-active')
    expect(generalSection).not.toHaveClass('is-active')
    expect(modelSection).toBeInTheDocument()
    expect(within(settingsWorkspace).queryByText('界面密度')).not.toBeInTheDocument()
    expect(within(modelSection).getByRole('combobox', { name: '默认模型' })).toHaveValue('GPT-5.5')
    expect(within(modelSection).getByRole('combobox', { name: '选择模型配置' })).toHaveValue('日常工作')
    expect(within(modelSection).getByText('平衡质量和速度，适合大多数日常对话。')).toBeInTheDocument()
    expect(within(modelSection).getByRole('button', { name: '添加模型' })).toBeInTheDocument()
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '选择模型配置' }), '编程与项目')
    expect(within(modelSection).getByRole('combobox', { name: '选择模型配置' })).toHaveValue('编程与项目')
    expect(within(modelSection).getByText('更适合代码、长上下文和复杂任务。')).toBeInTheDocument()
    await user.click(within(modelSection).getByRole('button', { name: '添加模型' }))
    expect(within(modelSection).getByRole('textbox', { name: '模型名称' })).toHaveFocus()
    await user.type(within(modelSection).getByRole('textbox', { name: '模型名称' }), 'Qwen3 235B')
    await user.click(within(modelSection).getByRole('button', { name: '保存模型' }))
    expect(within(modelSection).getByRole('combobox', { name: '默认模型' })).toHaveValue('Qwen3 235B')
    expect(within(modelSection).getByRole('option', { name: 'Qwen3 235B' })).toBeInTheDocument()
    expect(within(modelSection).getByRole('combobox', { name: '思考等级' })).toHaveValue('高')
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '默认模型' }), 'GPT-5.4')
    await waitFor(() => expect(within(modelSection).getByRole('combobox', { name: '默认模型' })).toHaveValue('GPT-5.4'))
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '思考等级' }), '中')
    await waitFor(() => expect(within(modelSection).getByRole('combobox', { name: '思考等级' })).toHaveValue('中'))
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '回复速度' }), '更快')
    expect(within(modelSection).getByRole('combobox', { name: '回复速度' })).toHaveValue('更快')

    await user.click(screen.getByRole('button', { name: '权限与确认' }))
    const permissionSection = within(settingsWorkspace).getByRole('region', { name: '权限与确认' })
    expect(permissionSection).toHaveClass('is-active')
    expect(modelSection).not.toHaveClass('is-active')
    expect(within(permissionSection).getByRole('combobox', { name: '权限模式' })).toHaveValue('工作区模式')
    await user.selectOptions(within(permissionSection).getByRole('combobox', { name: '权限模式' }), '只读模式')
    await waitFor(() => expect(within(permissionSection).getByRole('combobox', { name: '权限模式' })).toHaveValue('只读模式'))

    await user.click(screen.getByRole('button', { name: '通知' }))
    expect(screen.getByRole('button', { name: '通知' })).toHaveClass('is-active')
    expect(within(settingsWorkspace).getByRole('region', { name: '通知' })).toHaveClass('is-active')
    expect(permissionSection).not.toHaveClass('is-active')
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回应用' }))
    expect(screen.getByLabelText('对话工作区')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument()
    expect(screen.getByLabelText('权限审核')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('告诉 CrawClaw 要做什么...')).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: '规划 CrawClaw Desktop 改造' }))
    await user.click(screen.getByRole('menuitem', { name: '重命名' }))
    const renameInput = screen.getByRole('textbox', { name: '重命名对话' })
    await user.clear(renameInput)
    await user.type(renameInput, '新的桌面对话标题')
    await user.click(screen.getByRole('button', { name: '保存重命名' }))
    expect(screen.getByRole('button', { name: '新的桌面对话标题' })).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: '新的桌面对话标题' }))
    await user.click(screen.getByRole('menuitem', { name: '复制链接' }))
    expect(screen.queryByRole('menu', { name: '对话操作菜单' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '侧边栏操作反馈' })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: '新的桌面对话标题' }))
    await user.click(screen.getByRole('menuitem', { name: '归档' }))
    expect(screen.queryByRole('button', { name: '新的桌面对话标题' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '侧边栏操作反馈' })).not.toBeInTheDocument()
  })

  it('opens settings with local preferences when the Desktop API is unavailable', async () => {
    vi.stubEnv('VITE_CRAWCLAW_DESKTOP_FIXTURE', '0')
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(screen.getByText('CrawClaw Desktop Gateway URL is not available.')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '设置' }))

    const settingsWorkspace = screen.getByRole('region', { name: '设置 工作区' })
    expect(settingsWorkspace).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '设置导航' })).toBeInTheDocument()
    expect(within(settingsWorkspace).queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()

    const modelSection = within(settingsWorkspace).getByRole('region', { name: '模型与回复' })
    const permissionSection = within(settingsWorkspace).getByRole('region', { name: '权限与确认' })
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '默认模型' }), 'GPT-5.4')
    expect(within(modelSection).getByRole('combobox', { name: '默认模型' })).toHaveValue('GPT-5.4')
    await user.selectOptions(within(modelSection).getByRole('combobox', { name: '思考等级' }), '中')
    expect(within(modelSection).getByRole('combobox', { name: '思考等级' })).toHaveValue('中')
    await user.selectOptions(within(permissionSection).getByRole('combobox', { name: '权限模式' }), '只读模式')
    expect(within(permissionSection).getByRole('combobox', { name: '权限模式' })).toHaveValue('只读模式')
  })

  it('keeps the memory workspace focused on user-readable memories', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '记忆' }))

    const memoryWorkspace = screen.getByRole('region', { name: '记忆 工作区' })
    expect(within(memoryWorkspace).getByRole('heading', { name: '记忆' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()
    expect(within(memoryWorkspace).queryByText(/durable|sessionSummary|agent docs/i)).not.toBeInTheDocument()
    expect(within(memoryWorkspace).queryByText('同步状态')).not.toBeInTheDocument()
    expect(within(memoryWorkspace).queryByText('provider 状态')).not.toBeInTheDocument()
    expect(within(memoryWorkspace).getByLabelText('选择智能体')).toHaveValue('agent-main')
    expect(within(memoryWorkspace).queryByRole('list', { name: '记忆列表' })).not.toBeInTheDocument()

    const filterGroup = within(memoryWorkspace).getByRole('radiogroup', { name: '分类筛选' })
    expect(within(filterGroup).getAllByRole('radio').map((item) => item.textContent)).toEqual([
      '全部',
      '偏好',
      '项目',
      '经验',
      '其他',
    ])

    expect(within(memoryWorkspace).getByRole('heading', { name: '默认使用简洁桌面界面' })).toBeInTheDocument()
    expect(within(memoryWorkspace).queryByLabelText('记忆条目')).not.toBeInTheDocument()
    expect(within(memoryWorkspace).getAllByText('CrawClaw Agent').length).toBeGreaterThan(0)
    expect(within(memoryWorkspace).getByText('来自对话')).toBeInTheDocument()
    expect(within(memoryWorkspace).getByText('桌面端')).toBeInTheDocument()
    expect(within(memoryWorkspace).getByText('简化')).toBeInTheDocument()
    expect(within(memoryWorkspace).queryByRole('status', { name: '做梦状态' })).not.toBeInTheDocument()
    await user.click(within(memoryWorkspace).getByRole('button', { name: '做梦' }))
    expect(within(memoryWorkspace).getByRole('button', { name: '做梦中' })).toBeDisabled()
    expect(within(memoryWorkspace).getByRole('status', { name: '做梦状态' })).toHaveTextContent('正在整理记忆')
    expect(within(memoryWorkspace).getByRole('status', { name: '做梦状态' })).toHaveTextContent('最近对话')
    expect(within(memoryWorkspace).getByRole('status', { name: '做梦状态' })).toHaveTextContent('CrawClaw Agent')

    await user.selectOptions(within(memoryWorkspace).getByLabelText('选择智能体'), 'agent-workflow')
    expect(within(memoryWorkspace).getByRole('heading', { name: 'Gateway 设置重载经验' })).toBeInTheDocument()
    expect(within(memoryWorkspace).getAllByText('Workflow Runner').length).toBeGreaterThan(0)

    await user.type(within(memoryWorkspace).getByRole('searchbox', { name: '搜索记忆' }), 'Gateway')
    expect(within(memoryWorkspace).getByRole('heading', { name: 'Gateway 设置重载经验' })).toBeInTheDocument()

    await user.clear(within(memoryWorkspace).getByRole('searchbox', { name: '搜索记忆' }))
    await user.selectOptions(within(memoryWorkspace).getByLabelText('选择智能体'), 'agent-main')
    await user.click(within(filterGroup).getByRole('radio', { name: '项目' }))
    expect(within(memoryWorkspace).getByRole('heading', { name: 'CrawClaw Desktop 本机项目' })).toBeInTheDocument()
    expect(within(memoryWorkspace).queryByRole('heading', { name: 'Gateway 设置重载经验' })).not.toBeInTheDocument()

    await user.click(within(filterGroup).getByRole('radio', { name: '全部' }))
    await user.click(within(memoryWorkspace).getByRole('button', { name: '添加记忆' }))
    expect(within(memoryWorkspace).getByRole('form', { name: '添加记忆' })).toBeInTheDocument()
    await user.type(within(memoryWorkspace).getByLabelText('标题'), '发布前检查清单')
    await user.type(within(memoryWorkspace).getByLabelText('一句话摘要'), '提交前先跑直接相关验证')
    await user.type(within(memoryWorkspace).getByLabelText('内容'), '提交前检查测试、构建和 diff，确认没有无关修改。')
    await user.selectOptions(within(memoryWorkspace).getByLabelText('分类'), '经验')
    await user.type(within(memoryWorkspace).getByLabelText('标签'), '测试, 发布')
    await user.click(within(memoryWorkspace).getByRole('button', { name: '保存记忆' }))

    expect(within(memoryWorkspace).getByRole('heading', { name: '发布前检查清单' })).toBeInTheDocument()
    expect(within(memoryWorkspace).getByText('手动添加')).toBeInTheDocument()
    expect(within(memoryWorkspace).queryByRole('form', { name: '添加记忆' })).not.toBeInTheDocument()

    await user.click(within(memoryWorkspace).getByRole('button', { name: '编辑记忆' }))
    await user.clear(within(memoryWorkspace).getByLabelText('详情标题'))
    await user.type(within(memoryWorkspace).getByLabelText('详情标题'), '发布前验证清单')
    await user.clear(within(memoryWorkspace).getByLabelText('详情摘要'))
    await user.type(within(memoryWorkspace).getByLabelText('详情摘要'), '提交前跑测试和构建')
    await user.click(within(memoryWorkspace).getByRole('button', { name: '保存修改' }))

    expect(within(memoryWorkspace).getByRole('heading', { name: '发布前验证清单' })).toBeInTheDocument()
    expect(within(memoryWorkspace).getByText('提交前跑测试和构建')).toBeInTheDocument()

    await user.click(within(memoryWorkspace).getByRole('button', { name: '清理记忆' }))

    expect(within(memoryWorkspace).queryByRole('heading', { name: '发布前验证清单' })).not.toBeInTheDocument()
  })

  it('renders the plugins catalog without tools and adds a custom skill', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '插件' }))

    expect(screen.getByRole('region', { name: '插件 工作区' })).toBeInTheDocument()
    const pluginsWorkspace = screen.getByRole('region', { name: '插件 工作区' })
    expect(screen.getByRole('heading', { name: '让 CrawClaw 按你的方式工作' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索插件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Built by CrawClaw' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在对话中试用' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument()
    const featuredSection = screen.getByRole('region', { name: 'Featured' })
    expect(pluginsWorkspace.querySelector('.plugin-market-row__action')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Built by CrawClaw' }))
    expect(screen.getByRole('menu', { name: '插件来源选择' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '全部来源' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '自定义' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '自定义' }))
    expect(within(featuredSection).getByText('没有找到匹配的插件。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自定义' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '自定义' }))
    await user.click(screen.getByRole('menuitem', { name: 'Built by CrawClaw' }))
    expect(within(featuredSection).getByText('macOS UI polish')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByRole('menu', { name: '插件状态选择' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '已启用' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '草稿' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '草稿' }))
    expect(within(featuredSection).getByText('n8n.workflow')).toBeInTheDocument()
    expect(within(featuredSection).queryByText('macOS UI polish')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '草稿' }))
    await user.click(screen.getByRole('menuitem', { name: '全部' }))

    await user.click(screen.getByRole('button', { name: '打开 Skill：macOS UI polish' }))
    expect(screen.getByRole('button', { name: '收起 Skill：macOS UI polish' })).toBeInTheDocument()
    expect(within(featuredSection).getByText('触发词 @macOS UI polish')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('搜索插件'), 'n8n')
    expect(within(featuredSection).getByText('n8n.workflow')).toBeInTheDocument()
    expect(within(featuredSection).queryByText('macOS UI polish')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加技能' }))
    expect(screen.getByRole('dialog', { name: '添加技能' })).toBeInTheDocument()
    expect(screen.getByLabelText('技能地址')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('GitHub 地址或技能地址')).toBeInTheDocument()
    expect(screen.queryByLabelText('技能名称')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('触发词')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('技能说明')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '添加技能' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加技能' }))
    await user.type(screen.getByLabelText('技能地址'), 'https://github.com/qianleigood/crawclaw/tree/main/skills/web-summary')
    expect(screen.getByRole('button', { name: '添加' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByRole('button', { name: '正在检查…' })).toBeDisabled()
    expect(screen.getByLabelText('技能地址')).toBeDisabled()
    expect(screen.getByLabelText('添加技能进度')).toBeInTheDocument()
    expect(screen.getByText('解析地址')).toBeInTheDocument()
    expect(screen.getByText('读取 Skill 信息')).toBeInTheDocument()
    expect(screen.getByText('校验入口文件')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '添加技能' })).not.toBeInTheDocument()
    }, { timeout: 2_000 })

    await user.clear(screen.getByPlaceholderText('搜索插件'))
    expect(screen.getByText('web-summary')).toBeInTheDocument()
    expect(screen.getByText('@web-summary')).toBeInTheDocument()
    expect(within(featuredSection).getByText('检查中')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(featuredSection).getByText('本地')).toBeInTheDocument()
    }, { timeout: 2_000 })
    expect(screen.getByRole('button', { name: '打开 Skill：web-summary' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '添加技能' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '在对话中试用' }))
    expect(screen.getByLabelText('对话工作区')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('告诉 CrawClaw 要做什么...')).toHaveValue('@macOS UI polish ')
  })

  it('shows a simplified single-list agent workspace', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: '智能体' }))

    expect(screen.getByRole('region', { name: '智能体 工作区' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '配置中心' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '智能体配置中心' })).not.toBeInTheDocument()
    expect(screen.getByText('3 个智能体')).toBeInTheDocument()
    expect(screen.queryByText('3 个 Agent')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: '智能体列表' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Skills' })).not.toBeInTheDocument()
    expect(screen.queryByText('基础信息')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('默认模型')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('思考等级')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('权限模式')).not.toBeInTheDocument()

    expect(container.querySelector('.agent-list--separated')).toBeInTheDocument()
    expect(container.querySelectorAll('.agent-list-row')).toHaveLength(3)
    expect(container.querySelectorAll('.agent-list-row + .agent-list-row')).toHaveLength(2)
    expect(container.querySelector('[aria-label="CrawClaw Agent 运行信息"]')).toHaveTextContent('运行中')
    expect(container.querySelector('[aria-label="CrawClaw Agent 运行信息"]')).toHaveTextContent('GPT-5.5')
    expect(container.querySelector('[aria-label="CrawClaw Agent 运行信息"] .agent-list-item__status')).toHaveClass('is-live')
    expect(container.querySelector('[aria-label="Workflow Runner 运行信息"] .agent-list-item__status')).not.toHaveClass('is-live')
    expect(container.querySelector('[aria-label="CrawClaw Agent 配置信息"]')).toHaveTextContent('思考模式')
    expect(container.querySelector('[aria-label="CrawClaw Agent 配置信息"]')).toHaveTextContent('高')
    expect(container.querySelector('[aria-label="CrawClaw Agent 配置信息"]')).toHaveTextContent('工作区模式')
    expect(container.querySelector('[aria-label="CrawClaw Agent 配置信息"]')).toHaveTextContent('3 个工具 · 2 个 Skill')
    expect(screen.getAllByRole('button', { name: /配置智能体：/ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: '配置智能体：CrawClaw Agent' })).toBeInTheDocument()
    expect(container.querySelectorAll('.agent-list-item__avatar')).toHaveLength(3)
    expect(screen.getByLabelText('CrawClaw Agent 头像')).toHaveTextContent('CA')
    expect(screen.getByRole('button', { name: 'CrawClaw Agent 默认 · GPT-5.5 · 运行中' })).toHaveClass('is-active')
    expect(screen.getAllByText('3 个工具 · 2 个 Skill').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 个渠道').length).toBeGreaterThan(0)
    expect(screen.getAllByText('语音关闭').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工作区模式').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Workflow Runner 自动化 · GPT-5.4 · 空闲' }))
    expect(screen.getByRole('button', { name: 'Workflow Runner 自动化 · GPT-5.4 · 空闲' })).toHaveClass('is-active')
    expect(screen.queryByRole('heading', { name: 'Workflow Runner' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建智能体' }))
    expect(screen.getByRole('dialog', { name: '新建智能体' })).toBeInTheDocument()
    expect(screen.getByLabelText('1 身份情感')).toBeInTheDocument()
    expect(screen.getByLabelText('2 模型选择')).toBeInTheDocument()
    expect(screen.getByLabelText('6 确认')).toBeInTheDocument()
    expect(container.querySelector('.agent-create-wizard__node-rail')).toBeInTheDocument()
    expect(container.querySelectorAll('.agent-create-wizard__node')).toHaveLength(6)
    expect(container.querySelectorAll('.agent-create-wizard__connector')).toHaveLength(5)
    expect(container.querySelectorAll('.agent-create-wizard__arrow')).toHaveLength(0)
    expect(screen.queryByRole('form', { name: '新建智能体' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    await user.type(screen.getByLabelText('智能体名称'), '网页研究员')
    expect(screen.queryByLabelText('智能体角色')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('任务说明')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('智能体设定 Markdown'), {
      target: {
        value: '# 网页资料研究员\n追踪网页资料并输出结构化摘要。',
      },
    })
    expect(screen.getByRole('button', { name: '下一步' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'AI 生成头像' }))
    expect(screen.getByText('已生成头像')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('情感提示词 Markdown'), {
      target: {
        value: '# 情感提示词\n保持温和但明确。',
      },
    })

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '模型选择' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '选择模型' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '模型配置' })).toHaveTextContent('当前配置')
    expect(screen.getByRole('button', { name: '模型 GPT-5.5 推荐' })).toHaveClass('is-selected')
    await user.click(screen.getByRole('button', { name: '模型 GPT-5.4' }))
    expect(screen.getByRole('region', { name: '模型配置' })).toHaveTextContent('GPT-5.4')
    await user.click(screen.getByRole('button', { name: '中' }))
    await user.click(screen.getByRole('button', { name: '只读模式' }))
    expect(screen.getByRole('region', { name: '模型配置' })).toHaveTextContent('思考模式 中')
    expect(screen.getByRole('region', { name: '模型配置' })).toHaveTextContent('权限 只读模式')

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '语音偏好' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '启用语音' }))
    expect(screen.queryByRole('checkbox', { name: '语音输入' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清晰' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '沉稳' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '声音来源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Qwen 系统音色' })).toHaveClass('is-selected')
    expect(screen.getByRole('region', { name: '预设音色' })).toHaveTextContent('Cherry')
    expect(screen.getByRole('button', { name: '音色 Cherry 推荐' })).toHaveClass('is-selected')
    await user.click(screen.getByRole('button', { name: '音色 Ethan' }))
    expect(screen.getByRole('button', { name: '音色 Ethan' })).toHaveClass('is-selected')
    await user.click(screen.getByRole('button', { name: '克隆声音' }))
    expect(screen.getByRole('region', { name: '克隆声音样本' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('克隆声音名称'), {
      target: {
        value: '网页研究员声音',
      },
    })
    await user.upload(
      screen.getByLabelText('上传克隆声音样本'),
      new File(['voice-sample'], 'researcher.wav', { type: 'audio/wav' }),
    )
    expect(screen.getByText('researcher.wav')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '根据情感提示词生成' }))
    expect(screen.getByLabelText('自定义语言风格')).toHaveValue('温和明确')
    fireEvent.change(screen.getByLabelText('自定义语言风格'), {
      target: {
        value: '沉着鼓励',
      },
    })
    await user.selectOptions(screen.getByLabelText('回复节奏'), '慢速')

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '绑定渠道' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '桌面' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '钉钉' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'ESP32' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'QQ Bot' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '微信' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '桌面 渠道配置' })).toHaveTextContent('本机桌面')
    expect(screen.queryByRole('region', { name: '飞书 渠道配置' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '飞书' }))
    expect(screen.getByRole('region', { name: '飞书 渠道配置' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('飞书 App ID'), {
      target: {
        value: 'cli_test_agent',
      },
    })
    fireEvent.change(screen.getByLabelText('飞书 App Secret'), {
      target: {
        value: 'feishu-secret',
      },
    })
    fireEvent.change(screen.getByLabelText('飞书 默认目标'), {
      target: {
        value: 'oc_research_room',
      },
    })

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '能力选择' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('启用工具：文件系统'))
    await user.click(screen.getByLabelText('启用 Skill：macOS UI polish'))

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '确认创建' })).toBeInTheDocument()
    expect(screen.getByText('追踪网页资料并输出结构化摘要。')).toBeInTheDocument()
    expect(screen.getByText('专业克制')).toBeInTheDocument()
    expect(screen.getByText('已填写情感提示词')).toBeInTheDocument()
    expect(screen.getByText(/语音已启用/)).toBeInTheDocument()
    expect(screen.getByText(/沉着鼓励/)).toBeInTheDocument()
    expect(screen.getByText(/克隆声音/)).toBeInTheDocument()
    expect(screen.getByText(/researcher.wav/)).toBeInTheDocument()
    expect(screen.getByText('桌面、飞书')).toBeInTheDocument()
    expect(screen.getByText(/飞书：cli_test_agent · 目标 oc_research_room/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创建智能体' }))
    expect(screen.getByRole('button', { name: '网页研究员 网页资料研究员 · GPT-5.4 · 草稿' })).toHaveClass('is-active')
    expect(screen.getByText('4 个智能体')).toBeInTheDocument()
    expect(screen.getByLabelText('网页研究员 头像')).not.toHaveClass('has-image')
    expect(screen.getByLabelText('网页研究员 运行信息')).toHaveTextContent('GPT-5.4')
    expect(screen.getByLabelText('网页研究员 配置信息')).toHaveTextContent('思考模式')
    expect(screen.getByLabelText('网页研究员 配置信息')).toHaveTextContent('中')
    expect(screen.getByLabelText('网页研究员 配置信息')).toHaveTextContent('只读模式')
    expect(screen.getByLabelText('网页研究员 配置信息')).toHaveTextContent('2 个渠道')
    expect(screen.getByLabelText('网页研究员 配置信息')).toHaveTextContent('语音已启用')
    expect(screen.queryByRole('dialog', { name: '新建智能体' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /智能体 Skill/ })).not.toBeInTheDocument()
  })

  it('opens a centered liquid-glass search overlay from the sidebar', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '搜索' }))

    const searchDialog = screen.getByRole('dialog', { name: '全局搜索' })
    expect(searchDialog).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索对话、智能体、工具或工作流')).toHaveFocus()
    expect(screen.getByRole('button', { name: '新对话' })).toHaveClass('is-active')
    expect(screen.queryByRole('region', { name: '搜索 工作区' })).not.toBeInTheDocument()
    expect(screen.queryByText('搜索工作区')).not.toBeInTheDocument()
    expect(container.querySelector('.search-modal--liquid')).toBeInTheDocument()
    expect(screen.getByText('最近搜索')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '搜索' }), 'n8n')
    expect(within(searchDialog).getByText('n8n 工作流')).toBeInTheDocument()
    expect(within(searchDialog).queryByText('CrawClaw Agent')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'n8n 工作流' }))
    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '自动化 工作区' })).toBeInTheDocument()
    expect(screen.queryByLabelText('权限审核')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉 CrawClaw 要做什么...')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '搜索' }))
    await user.clear(screen.getByRole('textbox', { name: '搜索' }))
    await user.type(screen.getByRole('textbox', { name: '搜索' }), '没有这个结果')
    expect(screen.getByText('没有匹配结果')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument()
  })

  it('pages batch images with arrows and dots', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    expect(container.querySelectorAll('.batch-image-grid__tile')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '批量图片第 1 页' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '上一页批量图片' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页批量图片' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: '下一页批量图片' }))

    expect(container.querySelectorAll('.batch-image-grid__tile')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '批量图片第 2 页' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '上一页批量图片' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页批量图片' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '批量图片第 1 页' }))

    expect(screen.getByRole('button', { name: '批量图片第 1 页' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens centered previews for single and batch image messages', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '放大图片消息' }))

    const singleImagePreview = screen.getByRole('dialog', { name: '图片预览' })
    expect(singleImagePreview).toBeInTheDocument()
    expect(within(singleImagePreview).getByText('图片消息')).toBeInTheDocument()
    expect(within(singleImagePreview).getByText('分辨率 1280 x 720')).toBeInTheDocument()
    expect(document.querySelector('.image-preview-overlay')).toBeInTheDocument()
    expect(document.querySelector('.image-preview-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭图片预览' }))

    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '批量图片消息示例' }))

    const batchImagePreview = screen.getByRole('dialog', { name: '批量图片预览' })
    expect(batchImagePreview).toBeInTheDocument()
    expect(within(batchImagePreview).getByText('第 1 / 8 张')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一张图片' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一张图片' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: '下一张图片' }))

    expect(screen.getByText('第 2 / 8 张')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一张图片' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: '关闭图片预览' }))

    expect(screen.queryByRole('dialog', { name: '批量图片预览' })).not.toBeInTheDocument()
  })

  it('opens attachment controls without showing transient feedback bars', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByRole('menu', { name: '添加内容菜单' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '添加图片' }))
    expect(screen.queryByRole('menu', { name: '添加内容菜单' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '播放视频' }))
    expect(screen.getByRole('dialog', { name: '视频预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停视频' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '后退 10 秒' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '快进 10 秒' })).toBeInTheDocument()
    const videoProgress = screen.getByRole('slider', { name: '视频播放进度' }) as HTMLInputElement
    expect(videoProgress.value).toBe('18')
    expect(videoProgress).toHaveAttribute('aria-valuetext', '00:18 / 00:42')
    expect(screen.getByText('00:18')).toBeInTheDocument()
    expect(screen.getByText('00:42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭视频预览' })).toBeInTheDocument()
    expect(document.querySelector('.video-preview-overlay')).toBeInTheDocument()
    expect(document.querySelector('.video-preview-modal')).toBeInTheDocument()
    expect(document.querySelector('.video-preview-controls')).toBeInTheDocument()
    expect(document.querySelector('.video-preview-visual .video-play')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '快进 10 秒' }))
    expect(videoProgress.value).toBe('28')
    expect(videoProgress).toHaveAttribute('aria-valuetext', '00:28 / 00:42')
    await user.click(screen.getByRole('button', { name: '后退 10 秒' }))
    expect(videoProgress.value).toBe('18')
    expect(videoProgress).toHaveAttribute('aria-valuetext', '00:18 / 00:42')

    fireEvent.input(videoProgress, { target: { value: '31' } })
    expect(videoProgress.value).toBe('31')
    expect(videoProgress).toHaveAttribute('aria-valuetext', '00:31 / 00:42')
    expect(screen.getByText('00:31')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭视频预览' }))
    expect(screen.queryByRole('dialog', { name: '视频预览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开图片所在文件夹' }))
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开批量图片所在文件夹' }))
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开附件' }))
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '在文件夹中显示' }))
    expect(screen.queryByRole('status', { name: '界面操作反馈' })).not.toBeInTheDocument()
  })
})
