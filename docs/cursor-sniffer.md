# Cursor Traffic Sniffer & Analyzer

一个用于拦截和分析 Cursor 客户端与服务器之间通信的调试工具。

[English](./cursor-sniffer.en.md) | **中文**

## 功能概述

- **流量拦截**：作为 HTTP 代理运行，拦截 Cursor 与 `api2.cursor.sh` 之间的通信
- **Protobuf 解析**：自动解析 gRPC-Web + Protobuf 格式的消息
- **消息分析**：识别并格式化输出各类消息类型（聊天请求、工具调用、KV 存储等）
- **交互式模式**：手动输入 protobuf 数据进行分析
- **一键启动**：自动配置代理并启动 Cursor
- **内置 TLS 拦截**：支持 HTTPS 流量拦截，自动管理证书
- **Web UI**：可视化界面实时查看和分析流量
- **mitmproxy 集成**：提供 Python 插件与 mitmproxy 无缝配合

## 快速开始

### 最简单的方式（推荐）

```bash
# 一键启动：自动配置代理并打开 Cursor
bun run sniffer:cursor

# 或者带 Web UI
bun run sniffer:ui
# 然后在浏览器打开 http://localhost:8889
```

### 前置条件

- Bun 运行时
- 项目依赖已安装 (`bun install`)
- （可选）openssl（用于 TLS 拦截模式）
- （可选）mitmproxy（用于高级 HTTPS 拦截）

## 运行模式

### 模式一：一键启动（推荐）

最简单的使用方式，一条命令完成所有配置：

```bash
# 启动代理并自动打开 Cursor
bun run sniffer:cursor

# 启动带 TLS 拦截的版本
bun run sniffer:cursor --tls
```

这会：

1. 启动代理服务器
2. 自动设置 HTTP_PROXY 和 HTTPS_PROXY 环境变量
3. 启动 Cursor IDE

### 模式二：Web UI

提供可视化界面查看流量：

```bash
bun run sniffer:ui
```

然后：

1. 在浏览器打开 <http://localhost:8889>
2. 手动配置 Cursor 使用代理（见下文）·

Web UI 功能：

- 实时流量列表
- 请求/响应详情面板
- Protobuf 字段可视化
- 消息过滤和搜索
- 导出功能

### 模式三：基础代理

传统的代理模式，需要手动配置：

```bash
# 终端 1：启动代理
bun run sniffer --port 8888 --verbose

# 终端 2：配置 Cursor 使用代理
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
cursor .
```

### 模式四：TLS 拦截

内置 HTTPS 拦截，无需外部工具：

```bash
bun run sniffer:tls
```

首次使用需要安装 CA 证书：

```bash
# Linux
sudo cp ~/.cursor-sniffer/ca.crt /usr/local/share/ca-certificates/cursor-sniffer.crt
sudo update-ca-certificates

# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.cursor-sniffer/ca.crt
```

### 模式五：交互式分析

手动输入 protobuf 数据进行分析：

```bash
bun run sniffer:interactive
```

**可用命令**：

```
> hex 0a0568656c6c6f          # 分析十六进制编码的 protobuf
> b64 CgVoZWxsbw==            # 分析 base64 编码的 protobuf
> file /path/to/data.bin      # 分析文件中的 protobuf 数据
> q                           # 退出
```

### 模式六：文件分析

直接分析捕获的文件：

```bash
# 自动检测格式
bun run sniffer:analyze captured.bin

# 分析 SSE 格式文件
bun run scripts/cursor-sniffer.ts --analyze-sse response.txt

# 指定格式
bun run scripts/cursor-sniffer.ts --analyze-file data.bin --format hex
```

## 命令行参考

### 所有可用命令

```bash
bun run sniffer              # 启动基础代理
bun run sniffer:verbose      # 启动代理（详细输出）
bun run sniffer:interactive  # 交互式分析模式
bun run sniffer:cursor       # 一键启动（自动配置并启动 Cursor）
bun run sniffer:tls          # TLS 拦截模式
bun run sniffer:ui           # Web UI 模式
bun run sniffer:analyze      # 分析文件
```

### 命令行选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port <port>` | 代理服务器端口 | 8888 |
| `--ui-port <port>` | Web UI 端口 | 8889 |
| `--output <file>` | 保存捕获的流量到文件 | - |
| `--verbose, -v` | 显示完整消息内容 | false |
| `--raw, -r` | 显示原始十六进制数据 | false |
| `--with-cursor` | 一键启动模式 | false |
| `--tls` | 启用 TLS 拦截 | false |
| `--ui` | 启用 Web UI | false |
| `--analyze-file <path>` | 分析文件（自动检测格式） | - |
| `--analyze-sse <path>` | 分析 SSE 格式文件 | - |
| `--format <fmt>` | 强制指定格式：hex/base64/sse/binary | auto |
| `--direction <dir>` | 提示数据方向：request/response | - |
| `--help, -h` | 显示帮助信息 | - |

## 配合 mitmproxy 使用

本工具提供了 mitmproxy 插件，可以与 mitmproxy 无缝配合：

### 使用内置插件

```bash
# 1. 安装 mitmproxy
pip install mitmproxy

# 2. 使用插件启动
mitmdump -s scripts/mitmproxy-addon.py -p 8080

# 3. 启用详细输出
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_verbose=true

# 4. 保存到文件
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_output=traffic.log

# 5. 过滤模式（减少噪音）
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_filter=smart
```

### 过滤模式

mitmproxy 插件支持多种过滤模式，减少后台请求的干扰：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `smart` | 隐藏后台噪音（代码库同步、遥测等）| **推荐**，日常分析 |
| `ai` | 仅显示 AI 相关请求（模型、对话） | 专注分析 AI 交互 |
| `all` | 显示所有请求 | 完整调试 |
| `quiet` | 仅统计请求数量 | 性能监控 |

示例：

```bash
# 智能过滤（推荐）- 隐藏 SyncMerkleSubtreeV2、traces 等高频后台请求
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_filter=smart

# 仅显示 AI 请求
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_filter=ai

# 组合使用
mitmdump -s scripts/mitmproxy-addon.py -p 8080 \
  --set cursor_filter=smart \
  --set cursor_verbose=true \
  --set cursor_output=ai-traffic.log
```

### 配置 Cursor IDE

```bash
# 安装 CA 证书（首次使用）
# Linux
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
sudo update-ca-certificates

# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem

# 配置 Cursor 使用代理
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
cursor .
```

### 配置 cursor-agent CLI（重要！）

`cursor-agent` 命令行工具**不会**遵循 `HTTP_PROXY` 环境变量，需要使用 `proxychains` 强制代理：

#### 方式一：使用辅助脚本（推荐）

```bash
# 使用我们提供的包装脚本
./scripts/proxy-cursor-agent.sh --print "你好"

# 或者交互模式
./scripts/proxy-cursor-agent.sh
```

#### 方式二：手动配置 proxychains

```bash
# 1. 安装 proxychains
sudo apt install proxychains4  # Debian/Ubuntu
brew install proxychains-ng    # macOS

# 2. 创建配置文件 ~/.proxychains.conf
cat > ~/.proxychains.conf << 'EOF'
strict_chain
proxy_dns
remote_dns_subnet 224

# 不代理本地连接（重要！）
localnet 127.0.0.0/255.0.0.0
localnet ::1/128

[ProxyList]
http 127.0.0.1 8080
EOF

# 3. 启动 mitmproxy（启用流式传输支持）
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set stream_large_bodies=1

# 4. 运行 cursor-agent（需要设置 CA 证书）
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
proxychains4 -f ~/.proxychains.conf cursor-agent --print "你好"
```

#### 常见问题

**Q: 为什么需要 proxychains？**

`cursor-agent` 使用的网络库（可能是 Rust 实现）不遵循标准的 `HTTP_PROXY` 环境变量。`proxychains` 在系统调用层面拦截网络连接，强制所有流量通过代理。

**Q: 连接被拒绝（`<--denied`）怎么办？**

确保 `~/.proxychains.conf` 中包含 `localnet 127.0.0.0/255.0.0.0`，否则 proxychains 会尝试代理本地连接（导致循环）。

**Q: TLS 证书错误怎么办？**

确保设置了 `NODE_EXTRA_CA_CERTS` 环境变量：

```bash
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
```

## 输出格式

### 请求分析

```
═══════════════════════════════════════════════════════════
 Request #1
═══════════════════════════════════════════════════════════
  Method: POST
  URL: https://api2.cursor.sh/aiserver.v1.AgentService/RunSSE
  Auth: Bearer eyJ...

── REQUEST /aiserver.v1.BidiService/BidiAppend ──
  Type: BidiAppendRequest
  Data: 256 bytes
  Message: AgentRunRequest
  Details: {
    "action": {
      "userMessage": {
        "text": "请帮我写一个 hello world 程序",
        "mode": 1
      }
    },
    "model": "claude-sonnet-4.5",
    "conversationId": "abc123..."
  }
```

### 响应分析

```
── RESPONSE /aiserver.v1.AgentService/RunSSE ──
  InteractionUpdate: text
    "好的，我来帮你写一个 hello world 程序..."
  InteractionUpdate: tool_call_started
    {"callId": "call_123", "name": "write", "arguments": "..."}
  ExecServerMessage: shell
    {"id": 1, "command": "echo 'hello world'", "cwd": "/home/user"}
  Checkpoint: conversation_checkpoint
  InteractionUpdate: turn_ended
```

## 支持的消息类型

### AgentClientMessage（客户端 → 服务器）

| 字段编号 | 类型 | 说明 |
|----------|------|------|
| 1 | AgentRunRequest | 初始聊天请求 |
| 2 | ExecClientMessage | 工具执行结果 |
| 3 | KvClientMessage | KV 存储操作 |
| 4 | ConversationAction | 会话控制（如 resume） |
| 5 | ExecClientControlMessage | 执行控制消息 |

### AgentServerMessage（服务器 → 客户端）

| 字段编号 | 类型 | 说明 |
|----------|------|------|
| 1 | InteractionUpdate | 对话更新（文本/思考/工具调用） |
| 2 | ExecServerMessage | 工具执行请求 |
| 3 | Checkpoint | 会话检查点 |
| 4 | KvServerMessage | KV 存储消息 |
| 5 | ExecServerControlMessage | 执行控制消息（如 abort） |
| 7 | InteractionQuery | 交互查询 |

### InteractionUpdate 子类型

| 字段编号 | 类型 | 说明 |
|----------|------|------|
| 1 | text_delta | 文本增量 |
| 2 | tool_call_started | 工具调用开始 |
| 3 | tool_call_completed | 工具调用完成 |
| 4 | thinking_delta | 思考过程增量（推理模型） |
| 7 | partial_tool_call | 部分工具调用 |
| 8 | token_delta | Token 增量 |
| 13 | heartbeat | 心跳 |
| 14 | turn_ended | 回合结束 |

### ExecServerMessage 类型

| 类型 | 说明 |
|------|------|
| shell | Shell 命令执行 |
| read | 文件读取 |
| write | 文件写入 |
| ls | 目录列表 |
| grep | 内容搜索 |
| mcp | MCP 工具调用 |

## 使用场景

### 1. 调试协议问题

当插件与 Cursor API 通信出现问题时，使用此工具查看实际发送和接收的数据。

```bash
# 最简单的方式
bun run sniffer:cursor --verbose

# 或使用 Web UI 查看
bun run sniffer:ui
```

### 2. 分析新消息类型

发现未知的 protobuf 字段时，使用原始模式查看数据：

```bash
bun run scripts/cursor-sniffer.ts --verbose --raw
```

### 3. 逆向工程

分析 Cursor 客户端的通信协议，用于扩展插件功能：

```bash
# 使用 mitmproxy 插件获取完整 HTTPS 流量
mitmdump -s scripts/mitmproxy-addon.py -p 8080 --set cursor_verbose=true
```

### 4. 验证编码实现

检查插件生成的 protobuf 消息是否正确：

```bash
# 分析保存的文件
bun run sniffer:analyze captured.bin --verbose

# 分析 SSE 响应
bun run scripts/cursor-sniffer.ts --analyze-sse response.txt
```

## 技术细节

### Connect Protocol 信封格式

每个 gRPC-Web 消息都有 5 字节的信封：

```
[flags: 1 byte] [length: 4 bytes big-endian] [protobuf payload]
```

本工具会自动移除信封并解析 payload。

### Protobuf Wire Types

| Wire Type | 含义 | 编码方式 |
|-----------|------|----------|
| 0 | Varint | 可变长度整数 |
| 1 | 64-bit | 固定 8 字节 |
| 2 | Length-delimited | 长度前缀 + 数据 |
| 5 | 32-bit | 固定 4 字节 |

### SSE 响应格式

Cursor API 使用 Server-Sent Events 返回流式响应：

```
data: [base64-encoded protobuf with envelope]

data: [base64-encoded protobuf with envelope]

data: [DONE]
```

### 文件结构

```
scripts/
├── cursor-sniffer.ts        # 主入口脚本
├── mitmproxy-addon.py       # mitmproxy 集成插件
└── sniffer/
    ├── analyzer.ts          # 核心分析逻辑
    ├── tls-proxy.ts         # TLS 拦截代理
    ├── web-ui.ts            # Web UI 服务器
    └── types.ts             # 共享类型定义
```

## 故障排除

### 代理连接失败

确保 Cursor 正确配置了代理环境变量：

```bash
# 检查环境变量
echo $HTTP_PROXY
echo $HTTPS_PROXY

# 测试代理连接
curl -x http://127.0.0.1:8888 https://api2.cursor.sh/
```

### 证书信任问题

对于 HTTPS 拦截，需要信任代理的 CA 证书：

```bash
# 使用内置 TLS 代理时
export NODE_EXTRA_CA_CERTS=~/.cursor-sniffer/ca.crt

# 使用 mitmproxy 时
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
```

### Cursor 无法启动

如果一键启动模式无法找到 Cursor，尝试手动配置：

```bash
# 启动代理
bun run sniffer

# 手动配置并启动 Cursor
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
cursor .
```

### 解析错误

如果遇到解析错误，尝试使用原始模式查看数据：

```bash
bun run scripts/cursor-sniffer.ts --raw

# 或在交互模式中
> hex [数据]
```

## 相关文档

- [技术设计文档](./technical-design.zh-cn.md) - 了解完整的协议实现细节
- [故障排除指南](./troubleshooting.md) - 常见问题和解决方案
- [mitmproxy 文档](https://docs.mitmproxy.org/) - 完整的 HTTPS 拦截工具
