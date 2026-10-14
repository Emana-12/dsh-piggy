# dsh-piggy：交给支持 Hook 的 Agent 自动接入

> 这份文件是给另一个 Agent 的 AI 助手看的。把本文件和完整的 `dsh-piggy` 源码目录一起交给它，并要求它直接执行接入，不要只给出建议。

## 你的任务

把 dsh-piggy 接入当前 Agent，使用户可以：

1. 在该 CLI 内查询绑定的桌面小猪；
2. 在该 CLI 内执行允许的养成操作；
3. 在该 Agent 的工作状态变化后，把统一工作事件记入同一只桌面小猪。

不要重写养成规则，不要复制 `state.json`，不要创建第二份存档。桌面版是唯一存档所有者。

## 先判断能力

在修改文件前检查目标 Agent 是否提供：

- 本地插件或扩展目录；
- 能在生命周期事件后运行本地命令的 Hook；
- MCP 或等价的本地工具协议；
- 本地 Node.js 20+ 或其它能打开 TCP/Unix socket/Windows named pipe 的运行时。

如果缺少 Hook，但有 MCP，只接入查询和养成工具，并明确说明“工作状态提醒不可用”。如果缺少 MCP，但有 Hook，可以只接入工作状态提醒。两者都没有时停止，不要伪造已接入。

## 不可改变的边界

- `packages/pet-core/`、`store/`、`apps/desktop/` 是共享实现，不要为目标 Agent 复制一份。
- 不直接读写桌面 `state.json`。
- 不把提示词、源码、命令正文或工具参数发送给桌面版。
- 不自动重新配对、不覆盖绑定、不重置存档。
- 不绕过目标 Agent 的 Hook 信任或安全审批。

## 共享桌面桥协议

适配器应复用 `plugins/codex-piggy/lib/bridge-client.js` 的协议逻辑，或等价地实现以下请求：

```json
{
  "version": 1,
  "id": "每次请求唯一的 UUID",
  "method": "pair | status | action | event",
  "token": "配对文件中的 pairingToken"
}
```

桥接端点和配对文件由桌面版生成，位置规则见 `plugins/codex-piggy/lib/bridge-client.js`。通用适配器读取 `DSH_PIGGY_HOME`；没有该变量时才兼容 `CODEX_HOME`。桌面版和目标 Agent 必须使用同一个目录，但不要复制凭据。

### 通用 Agent 工作事件

```json
{
  "version": 1,
  "id": "请求 UUID",
  "method": "event",
  "token": "配对 token",
  "pigId": "已绑定的小猪 ID",
  "event": "start | working | waiting | done | error | interrupt",
  "eventId": "稳定的去重 ID",
  "success": true
}
```

- 开始处理用户任务：`event=start, success=true`。
- 进入工具或模型工作阶段：`event=working, success=true`；桌面端有短冷却，避免刷屏。
- 等待用户审批、输入或外部资源：`event=waiting, success=false`。
- 工具或 Agent 失败：`event=error, success=false`。
- 一轮完成：`event=done, success=true`。
- 用户中断：`event=interrupt, success=false`。
- `eventId` 必须由 session、turn、tool invocation 等稳定标识计算，不能每次重试都随机变化。
- 发送失败必须静默跳过，不能阻断 CLI 原任务；消费类操作不能自动重试。

### MCP 工具

优先复用 `plugins/codex-piggy/server.js` 的工具定义和参数校验。至少提供：

- `piggy_pair`：用户明确要求连接或重新配对时调用；
- `piggy_status`：读取当前绑定小猪；
- `piggy_action`：执行照顾、学习、工作、旅行、钓鱼和其它已开放动作。

写操作必须使用绑定的 `pigId`，并把请求转给桌面桥。危险操作必须保留“先向用户说明影响并取得明确确认”的规则。

## 自动执行步骤

按顺序执行，不要跳过验收：

1. 识别 Agent 名称、版本、插件目录、配置目录和 Hook 文档/样例。
2. 复制 `adapters/generic/bridge-client.mjs` 到目标 Agent 适配器目录，按目标运行时调整入口格式，并设置 `DSH_PIGGY_HOME` 指向桌面桥的共享凭据目录。
3. 复制 `plugins/codex-piggy/server.js` 的 MCP 工具层，转换成目标 Agent 的 MCP 清单格式；保留参数白名单和确认规则。
4. 根据目标 Agent 的真实事件字段生成 Hook，并映射为统一事件：
   - 任务开始 → `start`；
   - 工具或模型开始工作 → `working`；
   - 等待审批或用户输入 → `waiting`；
   - 工具或 Agent 失败 → `error`；
   - 回合完成 → `done`；
   - 用户中断 → `interrupt`。
5. 只在目标 Agent 的配置目录写入插件启用配置，并保留备份。
6. 如果目标 Agent 有 Hook 信任界面，提示用户在该界面审核；不得改写信任哈希。
7. 启动或确认桌面版 dsh-piggy 正在运行。
8. 执行 `piggy_pair`（仅在用户明确要求连接时）和 `piggy_status`。
9. 触发一次无副作用的工具调用和一次回合结束，检查桌面桥日志或状态中的事件计数。
10. 输出接入报告：生成了哪些文件、启用了哪些 Hook、MCP 是否可用、验收结果和未支持能力。

## 适配器模板

从 `adapters/generic/` 开始：

- `bridge-client.mjs`：桥协议最小客户端模板；
- `hook-adapter.template.mjs`：把目标 Agent 的 JSON 事件映射成统一生命周期事件；
- `README.md`：目标 AI 的改造清单。

目标 AI 必须把模板中的占位符替换为真实字段，不能原样安装占位符。

## 验收标准

只有同时满足以下条件才能报告“已接入”：

- CLI 能列出并调用 `piggy_status`；
- 返回的 `pigId` 与桌面版一致；
- 至少一条 Hook 事件被桌面桥接受；
- 重复发送同一个 `eventId` 不会重复计数；
- 桌面版离线时 CLI 原任务仍能完成；
- 适配器没有读写 `state.json`，也没有把提示词或工具内容发给桌面版。

## 失败处理

遇到以下情况必须报告“部分接入”或“无法接入”，不能声称成功：

- 目标 Agent 没有可执行本地 Hook；
- 目标 Agent 不支持 MCP 或等价工具协议；
- 桌面版不是包含 Agent 本机桥的 0.6.5+ 版本；
- 配对文件不存在、token 无效或 `pigId` 不一致；
- Hook 只能读取完整 transcript，无法只抽取事件类别和成功状态。

## 参考实现

Codex 的完整参考实现位于：

- `plugins/codex-piggy/plugin.json`
- `plugins/codex-piggy/hooks/hooks.json`
- `plugins/codex-piggy/hooks/work-event.js`
- `plugins/codex-piggy/server.js`
- `plugins/codex-piggy/lib/bridge-client.js`

目标 AI 可以复用协议和校验，但必须按照目标 Agent 的插件格式重新包装。
