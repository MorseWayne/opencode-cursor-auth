# OpenCode Cursor Proxy

[English](README.md) | **中文**

> **免责声明**
>
> 这是一个**实验性**社区项目，通过 **非官方接口** 与 Cursor 服务集成。
>
> - **随时可能中断**：Cursor 上游变更可能导致不可用
> - **不提供任何保证**：稳定性、兼容性与长期可用性均不承诺
> - **与 Cursor 无关且未获认可**
> - 可能违反 [Cursor 的服务条款](https://www.cursor.com/terms-of-service)，**存在封号/终止服务的风险**
>
> 使用本项目即表示您理解并自行承担全部风险。本项目仅用于教育与研究目的。

一个 OpenCode 插件，支持在 OpenCode 中使用 Cursor 的 AI 后端，具备 OAuth 认证、动态模型发现和完整的工具调用支持。

## 文档

- 🚀 [快速入门](docs/getting-started.md) - 安装和设置指南
- ⚙️ [配置说明](docs/configuration.md) - 所有配置选项
- 🔧 [故障排除](docs/troubleshooting.md) - 常见问题与解决方案
- 🏗️ [架构设计](docs/development/architecture.md) - 技术深度解析

## 功能特性

- **OpenCode 插件**：通过 OAuth 认证实现与 OpenCode 的原生集成
- **完整的工具调用支持**：支持 bash、read、write、list、glob/grep 等函数调用
- **动态模型发现**：自动从 Cursor 的 API 获取可用模型
- **流式支持**：通过 SSE 实现实时流式响应

## 快速开始（OpenCode 插件）

### 1) 配置 `opencode.json`

将插件和 Cursor 提供商添加到您的 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cursor-proxy@1.0.2"],
  "provider": {
    "cursor": { "name": "Cursor" }
  }
}
```

### 2) 认证

运行 OpenCode 并进行认证：

```bash
opencode auth login
```

然后：

1. 从提供商列表中选择 **"other"**
2. 输入 **"cursor"** 作为提供商名称
3. 选择 **"OAuth with Cursor"**
4. 完成基于浏览器的 OAuth 流程
5. 使用opencode models 查看当前支持的模型是否包含cursor, 你将会看到如下输出：

    ![models](./resource/screen_shot/models.png)

## 开发：独立代理服务器（可选）

> 独立代理服务器主要是用于测试/调试的开发产物。大多数用户应该优先使用上面的 OpenCode 插件。

### 先决条件

- [Bun](https://bun.sh)
- 一个具有有效凭据的 Cursor 账户

### 运行

```bash
git clone https://github.com/MorseWayne/opencode-cursor-proxy.git
cd opencode-cursor-proxy
bun install

# 先进行身份验证（脚本名为 auth）
bun run auth:login

# 启动服务器
bun run server
```

默认监听：`http://localhost:18741`

### 环境变量

#### 基础配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | `18741` |
| `HOST` | 服务器主机 | `localhost` |
| `CURSOR_ACCESS_TOKEN` | 直接提供访问令牌 | - |

#### 调试与日志

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CURSOR_DEBUG` | 启用调试日志 | `0` |
| `CURSOR_TIMING` | 启用性能计时日志 | `0` |
| `CURSOR_LOG_LEVEL` | 日志级别：`error`, `warn`, `info`, `debug` | `info` |
| `CURSOR_LOG_JSON` | 以 JSON 格式输出日志 | `0` |

#### 会话与缓存

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CURSOR_SESSION_REUSE` | 启用工具调用的会话复用 | `1` |
| `CURSOR_SESSION_TIMEOUT_MS` | 会话超时时间 (毫秒) | `900000` (15分钟) |
| `CURSOR_MAX_SESSIONS` | 最大缓存会话数 | `100` |
| `CURSOR_MODEL_CACHE_TTL_MS` | 模型缓存 TTL (毫秒) | `300000` (5分钟) |

#### 网络

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CURSOR_REQUEST_TIMEOUT_MS` | 请求超时时间 (毫秒) | `120000` (2分钟) |
| `CURSOR_MAX_RETRIES` | 最大重试次数 | `3` |
| `CURSOR_RETRY_ENABLED` | 启用自动重试 | `1` |
| `CURSOR_RETRY_BASE_DELAY_MS` | 指数退避基础延迟 (毫秒) | `1000` |
| `CURSOR_RETRY_MAX_DELAY_MS` | 重试最大延迟 (毫秒) | `30000` |

#### API

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CURSOR_API_URL` | Cursor API 基础 URL | `https://api2.cursor.sh` |
| `CURSOR_PRIVACY_MODE` | 启用隐私模式 | `1` |
| `CURSOR_CLIENT_VERSION` | 覆盖客户端版本头 | - |

## 许可证

MIT
