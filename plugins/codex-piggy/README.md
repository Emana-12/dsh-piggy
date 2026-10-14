# dsh-piggy Codex 插件

Codex 插件通过认证的本机桥访问正在运行的桌面版 dsh-piggy。Electron 主进程拥有唯一 store；插件不打开、不复制、不写入 state.json。

## 安装与配对

1. 准备 Git、Node.js 20+、Codex CLI 和本仓库工作副本（本地 Git 未提交的版本不要给别人；分享时需复制包含联动桥的完整源码目录）。在 Windows PowerShell 中进入仓库目录并运行：

   ```powershell
   .\scripts\install-codex-plugin.ps1
   ```

   脚本会添加本地 marketplace 并安装插件。macOS/Linux 可用 PowerShell 7 执行 `pwsh ./scripts/install-codex-plugin.ps1`，或按下方 CLI 命令手动安装。脚本会把插件启用在此仓库；重新运行可刷新本地安装。
2. 桌面外壳联动桥随本 Fork 的 `0.6.5` 源码提供。PowerShell 命令如下（桌面外壳和 Codex CLI 应使用同一个 `DSH_PIGGY_HOME`；不设置时才回退到 `CODEX_HOME`）：

   ```powershell
   cd apps/desktop
   npm install
   npm start
   ```

   保持桌面版运行；原版 `0.6.4` 外壳不包含联动桥，需使用本 Fork 构建的桌面版。Electron GUI 已在本机启动并完成窗口 ready/show/load 冒烟检查；桌面画面实时刷新和面板操作反向同步仍待验收。
3. 安装/更新后在 Codex 新建会话。明确调用 `piggy_pair` 绑定桌面猪，再调用 `piggy_status` 查看；纸盒状态下说“打开盒子”即可在 Codex 内开盒。普通状态查询和 Hook 均不会自动更换绑定。重置/重新领养会生成新的 pigId，用户明确要求后再调用 `piggy_pair`。
4. Codex Hooks 需在 `/hooks` 审查并信任。信任后，小猪会在用户提交任务、开始工作、完成、出错或中断时按自己的说话风格显示气泡；普通工具成功只记成长，工作中提示有短冷却，不会连续刷屏。未配对或桌面端离线时静默跳过，不影响原任务；若此版本没有钩子信任界面，可单独停用插件 Hooks，养成工具仍可用。
5. Codex 插件与桌面端必须使用同一个 `DSH_PIGGY_HOME`；未设置时使用 `CODEX_HOME`，再回退到 `%USERPROFILE%\.codex`。桌面端退出会移除短期凭据；重启后 MCP 使用新凭据，猪身份绑定保持不变。

手动 CLI 安装：`codex plugin marketplace add <完整源码仓库路径>`，然后 `codex plugin add dsh-piggy --marketplace dsh-piggy-local`。插件工具可在 CLI 与 Codex 桌面版中安装；工作事件 Hooks 目前仅由手动安装的 Codex 桌面插件支持，并须审核信任。Marketplace 使用相对于仓库根目录的插件路径，因此不能单独拷贝插件目录；使用者必须拿到同一份完整仓库源码和含桌面桥的 `0.6.5`。

### 验收状态

- Codex CLI 0.162.0-alpha.17.2 在隔离 `CODEX_HOME` 完成重复安装；插件显示启用，MCP 显示启用并能发现 4 个工具。
- MCP stdio 直接连接真实 Electron 桥，在隔离存档完成配对、开盒、状态回读和养成操作；各步读回的 `pigId` 一致。
- Electron 44.5.1 桌面外壳 0.6.5 在本机启动，窗口 ready、shown、页面 load 冒烟通过。
- 尚未证明 Codex agent 在一次模型对话中成功调用工具；实际 CLI 模型请求受网络会话超时影响。真实桌面画面刷新及从桌面面板操作后回读仍未完成验收。

## 工具

- `piggy_pair`：明确绑定到桌面当前存档。即使尚未孵化或存档为空，也可绑定空身份；之后用户明确要求开盒时，Codex 可直接孵化，并自动绑定新身份。
- `piggy_status`：读取已绑定猪的快照，操作不会更换绑定。
- `piggy_extensions`：查看已安装扩展/目录。已安装的在线扩展通过其公开 `ext` 动作操作；扩展安装需要在线目录，不接受任意上传的可执行扩展包。扩展状态、进度和展示数据随 `piggy_status` 返回。
- `piggy_action`：执行现有养成操作，包括照顾、交互、签到、学习、工作、旅行、钓鱼、物品、商店、换装与扩展动作。工作事件由已信任 Hook 记入成长。

重置、领养覆盖、安装或卸载在线扩展、替换皮肤等必须在向用户说明影响并得到确认后才执行。当前版本不支持从 Codex 导入自定义皮肤 ZIP 或用户提供的扩展包；请在桌面面板导入。动作超时后先查状态，不重试。所有玩法规则、冷却、背包和活动校验由桌面端现有逻辑负责。

Windows 使用本地命名管道；macOS/Linux 使用当前用户 Unix socket。桌面未运行或身份变更时会返回明确错误，不会建立副本存档。
