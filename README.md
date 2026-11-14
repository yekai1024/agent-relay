# Agent Relay

让主控 Agent 把任务交给其他编程 Agent，通过 A2A 跟踪任务并取回结果。相关任务可以复用同一会话的上下文。

当前提供 **CodeBuddy 接入**，已在 Windows + npm 安装的 CodeBuddy 2.183.0 上验证。OpenCode、Qoder 等是未来接入方向，尚未实现或验证；本项目目前不是通用 A2A 路由框架。

## 当前能力

- A2A 任务提交、状态查询、结果获取和取消。
- 同一存活会话连续分配任务，自动复用 `contextId`。
- UTF-8 中文传输；独立保存每个任务的结果。
- 首次探测模型目录并缓存，按显式模型或复杂度配置选模，无固定模型 ID。
- 默认无任务总超时，无自动付费模型降级。
- 零第三方运行依赖，沿用 CodeBuddy 本机登录。

任务执行使用 A2A over stdio；模型目录发现使用独立 ACP 元数据请求，不发送推理任务。当前启动参数、模型目录和 Answer 产物解析均针对 CodeBuddy，其他 Agent 需要各自验证。

## 快速开始

准备 Node.js 22.13+，通过 npm 安装并登录 CodeBuddy CLI。登录流程由 CodeBuddy 管理，勿将凭据放入仓库。

```powershell
git clone https://github.com/yekai1024/agent-relay.git
cd agent-relay
npm test
node .\a2a_worker.cjs models
```

终端 A 启动一个新会话，保持运行：

```powershell
node .\a2a_worker.cjs serve --session-dir "$PWD\sessions\demo" --tier routine
```

终端 B 进入同一仓库，将任务写入 UTF-8 的 `task.txt`，然后提交：

```powershell
node .\a2a_worker.cjs send --session-dir "$PWD\sessions\demo" --task-file "$PWD\task.txt"
```

用返回的任务 ID 等待结果：

```powershell
node .\a2a_worker.cjs wait --session-dir "$PWD\sessions\demo" --task-id TASK_ID
```

后续相关任务继续使用同一个会话目录执行 `send` / `wait`；不相关项目另建会话。一项任务结束后再提交下一项。

结束会话：

```powershell
node .\a2a_worker.cjs close --session-dir "$PWD\sessions\demo"
```

完整命令、Codex 指令示例和模型策略见 [CodeBuddy 使用指南](docs/codebuddy.md)。也可用 `npm run relay -- <命令和参数>` 调用。

## 模型策略

`models` 在首次使用、缓存超过 24 小时或 CLI 版本变化时重新探测；`models --refresh true` 强制刷新。切换账号后请手动刷新。目录列出模型与显示倍率，不保证剩余额度或实际推理权限。

`simple` / `routine` 默认从当前目录选择零倍率候选；不存在时停止，不自动切换付费模型。`--model MODEL_ID` 可显式选模，`complex` 需要显式模型或有选择理由的档位映射。[配置示例](model-policy.example.json) 需替换为实际目录里的模型 ID，不能直接使用占位符。价格不是能力排名，主控仍需结合任务需求和独立验收选择模型。

## 边界

- 当前仅验证 Windows、默认 npm 安装路径。自定义 npm prefix、独立二进制安装及 macOS/Linux 尚未支持。
- 执行 Agent 默认禁用内置工具与 MCP，只根据提供的上下文返回文本或代码；主控负责审查、应用和测试。
- 会话依赖 owner 和 CodeBuddy 进程持续存活，不承诺重启恢复。一个会话固定一个模型。
- 本地命名管道面向可信本机使用，不是网络服务或多用户安全边界，也不是操作系统沙箱。
- `validated: true` 只表示任务完成且存在 Answer，不代表内容正确。
- 日志和任务快照可能包含源码、提示词及推理过程；不要提交会话目录、模型缓存、个人策略或密钥。
- `answer` 已实现，但等待输入的交互尚未真实验收。取消、中文、多轮上下文和结果查询已有本机实测；不是全面的负载、恢复或安全认证。

## 开发与后续方向

```powershell
npm run check
npm test
```

离线测试不调用模型、不要求登录。CI 在 Windows 上运行语法检查和离线测试。

未来优先完善可配置的启动路径、Agent 接入边界和异常恢复；确认目标工具具有入站 A2A 能力后，再逐个加入 OpenCode、Qoder 等工具。欢迎提交问题和 PR，请提供版本、复现步骤及去除敏感信息的错误记录。

## License

[MIT](LICENSE)
