# 通用 Agent 适配器模板

本目录不是可直接安装的插件，而是给目标 Agent 的 AI 复制和改造的模板。

改造前必须阅读仓库根目录的 `docs/AI-CLI-接入指南.md`。目标 AI 要把模板中的占位字段替换成目标 Agent 的真实 Hook 输入字段和插件清单格式，不得原样宣称已接入。

模板只负责两件事：

1. 把目标 Agent 的 Hook 事件转换为统一的 `start`/`working`/`waiting`/`done`/`error`/`interrupt` 事件；
2. 通过统一桥协议调用桌面版，不接触 `state.json`。

`agent-events.mjs` 是统一事件白名单。目标 Agent 的适配器只能发送这五类事件，具体 Hook 名称和输入字段由目标 Agent 自己映射。

MCP 工具层请以 `plugins/codex-piggy/server.js` 为参考实现，并按目标 Agent 的 MCP 注册格式包装。每个 Agent 的 Hook 配置仍需按其真实 schema 单独生成，不能把 Codex 的 `hooks.json` 原样复制过去。
