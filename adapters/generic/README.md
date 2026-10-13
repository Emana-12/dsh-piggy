# 通用 CLI 适配器模板

本目录不是可直接安装的插件，而是给目标 CLI 的 AI 复制和改造的模板。

改造前必须阅读仓库根目录的 `docs/AI-CLI-接入指南.md`。目标 AI 要把模板中的占位字段替换成目标 CLI 的真实 Hook 输入字段和插件清单格式，不得原样宣称已接入。

模板只负责两件事：

1. 把目标 CLI 的 Hook 事件转换为桌面桥的 `tool`/`turn` 事件；
2. 通过统一桥协议调用桌面版，不接触 `state.json`。

MCP 工具层请以 `plugins/codex-piggy/server.js` 为参考实现，并按目标 CLI 的 MCP 注册格式包装。
