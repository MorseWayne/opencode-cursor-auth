# Cursor Traffic Sniffer & Analyzer

一个用于拦截和分析 Cursor 客户端与服务器之间通信的调试工具。

[English](./cursor-sniffer.en.md) | **中文**

## 功能概述

- **流量拦截**：作为 HTTP 代理运行，拦截 Cursor 与 `api2.cursor.sh` 之间的通信
- **Protobuf 解析**：自动解析 gRPC-Web + Protobuf 格式的消息
- **消息分析**：识别并格式化输出各类消息类型（聊天请求、工具调用、KV 存储等）
- **交互式模式**：手动输入 protobuf 数据进行分析
- **管道分析**：支持从其他工具获取数据后分析

## 安装与运行

### 前置条件

- Bun 运行时
- 项目依赖已安装 (`bun install`)

### 运行方式

```bash
# 启动代理服务器（默认端口 8888）
bun run sniffer

# 启动代理服务器（详细输出）
bun run sniffer:verbose

# 启动交互式分析模式
bun run sniffer:interactive

# 直接运行脚本
bun run scripts/cursor-sniffer.ts [options]
```

## 使用模式

### 模式一：代理服务器

作为 HTTP 代理运行，拦截 Cursor 客户端的流量。

```bash
# 终端 1：启动代理
bun run sniffer --port 8888 --verbose

# 终端 2：配置 Cursor 使用代理
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
cursor .
```

**命令行选项**：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port <port>` | 代理服务器端口 | 8888 |
| `--output <file>` | 保存捕获的流量到文件 | - |
| `--verbose, -v` | 显示完整消息内容 | false |
| `--raw, -r` | 显示原始十六进制数据 | false |

**注意**：对于 HTTPS 流量拦截，需要设置证书信任。建议使用 [mitmproxy](https://mitmproxy.org/) 进行完整的 HTTPS 拦截。

### 模式二：交互式分析

手动输入 protobuf 数据进行分析。

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

**示例会话**：

```
Cursor Traffic Analyzer - Interactive Mode

Commands:
  hex <hexstring>   - Analyze hex-encoded protobuf
  b64 <base64>      - Analyze base64-encoded protobuf
  file <path>       - Analyze file content
  q                 - Quit

> hex 0a0568656c6c6f120577776f726c64

Analyzing 15 bytes...

field 1 (wire=2): "hello"
field 2 (wire=2): "world"
```

### 模式三：管道分析

从标准输入读取数据进行分析，适合与其他工具配合使用。

```bash
# 分析十六进制数据
echo "0a0568656c6c6f" | bun run scripts/cursor-sniffer.ts --analyze

# 分析 base64 数据
echo "CgVoZWxsbw==" | bun run scripts/cursor-sniffer.ts --analyze-base64

# 配合 mitmproxy 使用
# 1. 用 mitmproxy 捕获流量并导出
# 2. 提取 protobuf 数据
# 3. 分析
cat captured.bin | xxd -p | tr -d '\n' | bun run scripts/cursor-sniffer.ts --analyze
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

## 配合 mitmproxy 使用

对于完整的 HTTPS 流量拦截，建议使用 mitmproxy：

```bash
# 1. 安装 mitmproxy
pip install mitmproxy

# 2. 启动 mitmproxy
mitmproxy -p 8080

# 3. 安装 CA 证书（首次使用）
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem

# Linux
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
sudo update-ca-certificates

# 4. 配置 Cursor 使用代理
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
cursor .
```

然后可以在 mitmproxy 中查看流量，或导出后用本工具分析。

## 使用场景

### 1. 调试协议问题

当插件与 Cursor API 通信出现问题时，使用此工具查看实际发送和接收的数据。

```bash
# 启用详细模式
bun run sniffer:verbose
```

### 2. 分析新消息类型

发现未知的 protobuf 字段时，使用原始模式查看数据：

```bash
bun run scripts/cursor-sniffer.ts --verbose --raw
```

### 3. 逆向工程

分析 Cursor 客户端的通信协议，用于扩展插件功能：

```bash
# 启动交互式模式，手动分析捕获的数据
bun run sniffer:interactive

> hex [从 mitmproxy 复制的十六进制数据]
```

### 4. 验证编码实现

检查插件生成的 protobuf 消息是否正确：

```bash
# 在代码中添加日志输出 hex
console.log(Buffer.from(message).toString('hex'));

# 然后分析
echo "输出的hex" | bun run scripts/cursor-sniffer.ts --analyze
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
# 使用 mitmproxy 时
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
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
