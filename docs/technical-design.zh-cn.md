# OpenCode Cursor Proxy 技术方案

[English](TECHNICAL_DESIGN.md) | **中文**

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 系统架构](#2-系统架构)
- [3. 核心技术](#3-核心技术)
- [4. 实现细节](#4-实现细节)
- [5. 数据流](#5-数据流)
- [6. 安全性](#6-安全性)
- [7. 性能优化](#7-性能优化)
- [8. 扩展性](#8-扩展性)

---

## 1. 项目概述

### 1.1 项目定位

OpenCode Cursor Proxy 是一个 OpenCode 插件，允许用户在 OpenCode 中使用 Cursor 的 AI 后端服务。该项目通过非官方接口与 Cursor 服务集成，提供完整的 AI 对话、工具调用和流式响应功能。

### 1.2 核心能力

- **OpenCode 插件集成**：通过 OAuth 认证实现与 OpenCode 的原生集成
- **完整工具调用支持**：支持 bash、read、write、list、glob、grep 等函数调用
- **动态模型发现**：自动从 Cursor 的 API 获取可用模型列表
- **流式响应**：通过 SSE（Server-Sent Events）实现实时流式响应
- **会话重用**：优化工具调用场景的性能和上下文管理
- **独立代理服务器**：可选的独立服务器模式用于测试和调试

### 1.3 技术栈

- **运行时**：Bun
- **语言**：TypeScript
- **协议**：gRPC-Web (Connect Protocol) + SSE
- **编码**：Protocol Buffers
- **认证**：OAuth 2.0 with PKCE

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                          OpenCode                               │
│  ┌──────────────┐         ┌────────────────────────────────┐   │
│  │   OpenCode   │ ◄─────► │  opencode-cursor-proxy Plugin  │   │
│  │     Core     │         │                                │   │
│  └──────────────┘         │  - OAuth Authentication        │   │
│                           │  - Custom Fetch Function       │   │
│                           │  - Model Discovery             │   │
│                           │  - OpenAI-Compatible Adapter   │   │
│                           └────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ HTTPS
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
                ▼                                     ▼
     ┌─────────────────────┐              ┌──────────────────────┐
     │  Cursor Auth API    │              │  Cursor Agent API    │
     │  (OAuth + Refresh)  │              │  (BidiSse Protocol)  │
     └─────────────────────┘              └──────────────────────┘
     api2.cursor.sh/auth                  api2.cursor.sh/aiserver.v1
```

### 2.2 模块结构

```
src/
├── index.ts                    # 插件入口
├── server.ts                   # 独立服务器（可选）
├── plugin/                     # OpenCode 插件模块
│   ├── plugin.ts              # 插件主逻辑
│   ├── types.ts               # 类型定义
│   └── index.ts               # 导出
├── lib/
│   ├── api/                   # Cursor API 客户端
│   │   ├── cursor-client.ts   # 基础 HTTP 客户端
│   │   ├── agent-service.ts   # Agent 服务（聊天/工具调用）
│   │   ├── ai-service.ts      # AI 服务（模型列表）
│   │   ├── cursor-models.ts   # 模型管理
│   │   └── proto/             # Protobuf 编解码
│   ├── auth/                  # 认证模块
│   │   ├── login.ts           # OAuth PKCE 登录
│   │   ├── helpers.ts         # Token 刷新
│   │   └── index.ts           # 导出
│   ├── openai-compat/         # OpenAI API 兼容层
│   │   ├── handler.ts         # 请求处理器
│   │   ├── utils.ts           # 工具函数
│   │   ├── types.ts           # 类型定义
│   │   └── index.ts           # 导出（含 fetch 函数）
│   ├── utils/                 # 工具函数
│   │   ├── tokenizer.ts       # Token 计数
│   │   └── jwt.ts             # JWT 解析
│   ├── storage.ts             # 凭证存储
│   └── session-reuse.ts       # 会话重用管理
└── scripts/                   # 命令行工具
    ├── auth.ts                # 认证管理
    └── fetch-models.ts        # 模型列表获取
```

---

## 3. 核心技术

### 3.1 OAuth 2.0 with PKCE 认证

#### 认证流程

```
┌────────┐                 ┌─────────┐                 ┌────────────┐
│ Plugin │                 │ Browser │                 │ Cursor API │
└───┬────┘                 └────┬────┘                 └─────┬──────┘
    │                           │                            │
    │ 1. Generate PKCE params   │                            │
    │    - code_verifier        │                            │
    │    - code_challenge       │                            │
    │    - uuid                 │                            │
    ├──────────────────────────►│                            │
    │                           │                            │
    │ 2. Open login URL         │                            │
    │   (with challenge)        │                            │
    │                           ├───────────────────────────►│
    │                           │                            │
    │                           │ 3. User authenticates      │
    │                           │                            │
    │                           │◄───────────────────────────┤
    │                           │                            │
    │ 4. Poll for result        │                            │
    ├────────────────────────────────────────────────────────►│
    │   (with uuid + verifier)  │                            │
    │                           │                            │
    │◄────────────────────────────────────────────────────────┤
    │ 5. Return tokens          │                            │
    │    - access_token         │                            │
    │    - refresh_token        │                            │
    │                           │                            │
```

#### PKCE 参数生成

```typescript
// 1. 生成 32 字节随机 verifier
const verifier = base64URLEncode(randomBytes(32));

// 2. 计算 SHA-256 challenge
const challenge = base64URLEncode(sha256(verifier));

// 3. 生成唯一 UUID
const uuid = randomUUID();

// 4. 构造登录 URL
const loginUrl = `https://cursor.com/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login&redirectTarget=cli`;
```

#### Token 管理

- **Access Token**：用于 API 调用，有效期约 1 小时
- **Refresh Token**：用于刷新 access token，长期有效
- **自动刷新**：检测 token 过期并自动刷新（提前 60 秒）
- **持久化存储**：tokens 存储在本地文件系统

### 3.2 BidiSse 协议

Cursor 的 Agent API 使用 gRPC-Web (Connect Protocol) 的 BidiSse 模式，这是一种双向流式通信协议的特殊实现。

#### 协议特点

- **双向通信**：客户端和服务器都可以发送多条消息
- **流式接收**：使用 SSE (Server-Sent Events) 接收服务器消息
- **单独发送**：使用 HTTP POST 发送客户端消息

#### 请求流程

```
Client                                  Server
  │                                       │
  │ 1. POST /aiserver.v1.AgentService/RunSSE
  │    (with initial AgentRunRequest)      │
  ├──────────────────────────────────────►│
  │                                       │
  │◄──────────────────────────────────────┤
  │ 2. SSE stream begins                  │
  │    (InteractionUpdate chunks)         │
  │                                       │
  │ 3. POST /aiserver.v1.AgentService/BidiAppend
  │    (with tool results)                 │
  ├──────────────────────────────────────►│
  │                                       │
  │◄──────────────────────────────────────┤
  │ 4. More SSE chunks                    │
  │    (continue conversation)            │
  │                                       │
  │ 5. Conversation ends                  │
  │    (turn_ended / checkpoint)          │
  │◄──────────────────────────────────────┤
```

#### Protobuf 消息结构

**AgentClientMessage**：

```protobuf
message AgentClientMessage {
  optional AgentRunRequest run_request = 1;              // 初始请求
  optional ExecClientMessage exec_client_message = 2;    // 工具执行结果
  optional KvClientMessage kv_client_message = 3;        // 键值对消息
  optional ConversationAction conversation_action = 4;    // 会话动作
  optional ExecClientControlMessage exec_client_control_message = 5;
  optional InteractionResponse interaction_response = 6;
}
```

**AgentServerMessage**：

```protobuf
message AgentServerMessage {
  optional InteractionUpdate interaction_update = 1;         // 对话更新
  optional ExecServerMessage exec_server_message = 2;        // 工具调用请求
  optional ConversationCheckpoint conversation_checkpoint_update = 3; // 完成信号
  optional KvServerMessage kv_server_message = 4;            // 键值对消息
  optional ExecServerControlMessage exec_server_control_message = 5;
  optional InteractionQuery interaction_query = 7;           // 交互查询
}
```

**InteractionUpdate.message**：

```protobuf
message InteractionUpdateMessage {
  optional string text_delta = 1;       // 文本增量
  optional string thinking_delta = 4;   // 思考过程增量
  optional int32 token_delta = 8;       // Token 数量增量
  optional bool heartbeat = 13;         // 心跳
  optional bool turn_ended = 14;        // 回合结束
}
```

### 3.3 OpenAI API 兼容层

#### 请求转换

OpenAI 格式 → Cursor Agent 格式

```typescript
// OpenAI Request
{
  "model": "claude-sonnet-4.5",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "tools": [...]
}

// ↓ 转换为

// Cursor Agent Request
{
  run_request: {
    conversation_id: "<uuid>",
    model_details: {
      model_id: "claude-sonnet-4.5",
      model_owner: "anthropic"
    },
    mode: AgentMode.CHAT,
    conversation_action: {
      message: {
        text: "Hello",
        attachments: [],
        request_context: {...}
      }
    }
  }
}
```

#### 响应转换

Cursor Agent 格式 → OpenAI SSE 格式

```typescript
// Cursor InteractionUpdate
{
  interaction_update: {
    message: {
      text_delta: "Hello "
    }
  }
}

// ↓ 转换为

// OpenAI SSE Chunk
data: {
  "id": "chatcmpl-xxx",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "claude-sonnet-4.5",
  "choices": [{
    "index": 0,
    "delta": {
      "content": "Hello "
    },
    "finish_reason": null
  }]
}
```

### 3.4 工具调用机制

#### 支持的工具类型

1. **Shell 命令** (`bash`)
   - 执行系统命令
   - 返回标准输出和错误输出

2. **文件读取** (`read`)
   - 读取文件内容
   - 支持行范围限制

3. **文件写入** (`write`)
   - 创建或修改文件
   - 支持字符串替换

4. **目录列表** (`list`)
   - 列出目录内容
   - 支持递归和过滤

5. **文件搜索** (`glob`)
   - 基于模式匹配文件

6. **内容搜索** (`grep`)
   - 在文件中搜索文本
   - 支持正则表达式

7. **MCP 工具** (`mcp`)
   - 支持 Model Context Protocol 工具

#### 工具调用流程

```
OpenCode                Plugin                 Cursor Agent API
   │                      │                           │
   │ 1. User message      │                           │
   │  with tools          │                           │
   ├─────────────────────►│                           │
   │                      │                           │
   │                      │ 2. Chat request          │
   │                      │  with tool definitions   │
   │                      ├──────────────────────────►│
   │                      │                           │
   │                      │◄──────────────────────────┤
   │                      │ 3. Tool call request      │
   │                      │  (ExecServerMessage)      │
   │                      │                           │
   │◄─────────────────────┤                           │
   │ 4. Execute tool      │                           │
   │  (bash/read/write)   │                           │
   │                      │                           │
   ├─────────────────────►│                           │
   │ 5. Tool result       │                           │
   │                      │                           │
   │                      │ 6. Send result            │
   │                      │  (ExecClientMessage)      │
   │                      ├──────────────────────────►│
   │                      │                           │
   │                      │◄──────────────────────────┤
   │                      │ 7. Continue conversation  │
   │◄─────────────────────┤  with result              │
   │ 8. Final response    │                           │
```

#### ExecServerMessage 解析

```typescript
// Cursor 工具调用格式
{
  exec_server_message: {
    shell: {
      command: "ls -la",
      cwd: "/home/user"
    }
    // 或
    read: {
      path: "file.txt",
      start_line: 0,
      end_line: 100
    }
    // 或
    write: {
      path: "file.txt",
      old_string: "old",
      new_string: "new"
    }
    // 等等
  }
}
```

### 3.5 会话重用（Session Reuse）

#### 设计目标

- 减少重复的上下文传输
- 优化多轮工具调用性能
- 保持会话连续性

#### 实现机制

```typescript
// 1. 会话 ID 生成
const sessionId = createSessionId(); // 格式: "session-<uuid>"

// 2. 首次请求时注入会话 ID
messages = [
  {
    role: "system",
    content: `Session: ${sessionId}`
  },
  ...userMessages
];

// 3. 后续请求识别会话 ID
const existingSessionId = findSessionIdInMessages(messages);

// 4. 会话管理
sessionMap.set(sessionId, {
  conversationId,
  callIds: new Set(),
  lastAccessTime: Date.now()
});

// 5. 自动清理过期会话（15 分钟）
cleanupExpiredSessions(sessionMap, SESSION_TIMEOUT_MS);
```

#### 会话上下文优化

使用会话重用时，可以省略已发送的工具调用记录，只发送必要的上下文：

```typescript
// 不使用会话重用：每次请求都需要完整历史
[
  { role: "user", content: "Read file.txt" },
  { role: "assistant", tool_calls: [...] },
  { role: "tool", content: "file content..." },
  { role: "assistant", content: "..." },
  { role: "user", content: "Now modify it" },
  { role: "assistant", tool_calls: [...] },
  { role: "tool", content: "..." }
  // ... 历史越来越长
]

// 使用会话重用：只需要当前上下文
[
  { role: "system", content: "Session: session-xxx" },
  { role: "user", content: "Now modify it" }
  // 其余历史由服务器维护
]
```

---

## 4. 实现细节

### 4.1 Connect Protocol 实现

Cursor API 使用 gRPC-Web 的 Connect Protocol，这是一个基于 HTTP 的 RPC 协议。

#### 请求格式

```http
POST /aiserver.v1.AgentService/RunSSE HTTP/1.1
Host: api2.cursor.sh
Content-Type: application/connect+proto
Connect-Protocol-Version: 1
Connect-Timeout-Ms: 300000
Authorization: Bearer <access_token>

[Protobuf encoded message]
```

#### 响应格式（SSE）

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked

data: <base64-encoded-protobuf>

data: <base64-encoded-protobuf>

data: <base64-encoded-protobuf>

data: [DONE]
```

#### Connect Envelope 编码

Connect Protocol 使用特殊的 envelope 格式包装 Protobuf 消息：

```typescript
function addConnectEnvelope(protoBytes: Uint8Array): Uint8Array {
  const checksum = generateChecksum(protoBytes);
  const envelope = new Uint8Array(5 + protoBytes.length);
  
  // Flags byte (0x00 = uncompressed)
  envelope[0] = 0x00;
  
  // Length (4 bytes, big-endian)
  const view = new DataView(envelope.buffer);
  view.setUint32(1, protoBytes.length, false);
  
  // Protobuf message
  envelope.set(protoBytes, 5);
  
  return envelope;
}
```

### 4.2 Protobuf 编解码

由于 Cursor 的 Protobuf schema 是私有的，我们通过逆向工程实现了必要的编解码功能。

#### 基本编码函数

```typescript
// Varint 编码（用于字段编号和长度）
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

// 字段编码
function encodeField(fieldNumber: number, wireType: number, value: Uint8Array): Uint8Array {
  const tag = (fieldNumber << 3) | wireType;
  const tagBytes = encodeVarint(tag);
  return concat(tagBytes, value);
}

// 字符串字段
function encodeStringField(fieldNumber: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const lengthBytes = encodeVarint(valueBytes.length);
  return encodeField(fieldNumber, 2, concat(lengthBytes, valueBytes));
}
```

#### 消息解析

```typescript
function parseProtoFields(data: Uint8Array): Map<number, Uint8Array[]> {
  const fields = new Map<number, Uint8Array[]>();
  let offset = 0;
  
  while (offset < data.length) {
    // 读取 tag (field_number << 3 | wire_type)
    const [tag, tagLen] = readVarint(data, offset);
    offset += tagLen;
    
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;
    
    // 读取字段值
    let value: Uint8Array;
    if (wireType === 0) {
      // Varint
      const [val, len] = readVarint(data, offset);
      value = encodeVarint(val);
      offset += len;
    } else if (wireType === 2) {
      // Length-delimited
      const [length, lenLen] = readVarint(data, offset);
      offset += lenLen;
      value = data.slice(offset, offset + length);
      offset += length;
    }
    // ... 其他 wire types
    
    if (!fields.has(fieldNumber)) {
      fields.set(fieldNumber, []);
    }
    fields.get(fieldNumber)!.push(value);
  }
  
  return fields;
}
```

### 4.3 流式响应处理

#### SSE 解析器

```typescript
async function* parseSSEStream(response: Response): AsyncGenerator<Uint8Array> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          return;
        }
        
        // Base64 decode
        const protoBytes = base64Decode(data);
        
        // Remove Connect envelope (5 bytes)
        const message = protoBytes.slice(5);
        
        yield message;
      }
    }
  }
}
```

#### OpenAI SSE 格式化

```typescript
function formatOpenAIChunk(chunk: AgentStreamChunk): string {
  const data = {
    id: chunk.id,
    object: "chat.completion.chunk",
    created: chunk.created,
    model: chunk.model,
    choices: [{
      index: 0,
      delta: {
        role: chunk.role,
        content: chunk.content,
        tool_calls: chunk.tool_calls
      },
      finish_reason: chunk.finish_reason
    }]
  };
  
  return `data: ${JSON.stringify(data)}\n\n`;
}
```

### 4.4 模型发现和映射

#### Cursor 模型获取

```typescript
async function listCursorModels(client: CursorClient): Promise<CursorModelInfo[]> {
  const response = await client.aiService.GetModels({});
  
  return response.models.map(model => ({
    modelId: model.modelId,              // 内部 ID（用于 API 调用）
    displayModelId: model.displayModelId, // 显示 ID（用户可见）
    displayName: model.displayName,       // 显示名称
    displayNameShort: model.displayNameShort,
    aliases: model.aliases || [],         // 别名列表
    capabilities: model.capabilities
  }));
}
```

#### 模型 ID 解析

```typescript
function resolveModel(requestedModel: string, models: CursorModelInfo[]): string {
  // 1. 直接匹配 modelId
  const directMatch = models.find(m => m.modelId === requestedModel);
  if (directMatch) return directMatch.modelId;
  
  // 2. 匹配 displayModelId
  const displayMatch = models.find(m => m.displayModelId === requestedModel);
  if (displayMatch) return displayMatch.modelId;
  
  // 3. 匹配别名
  const aliasMatch = models.find(m => m.aliases.includes(requestedModel));
  if (aliasMatch) return aliasMatch.modelId;
  
  // 4. 回退到请求的模型名
  return requestedModel;
}
```

#### 模型能力映射

```typescript
function mapModelCapabilities(cursorModel: CursorModelInfo): ModelCapabilities {
  const isThinking = 
    cursorModel.modelId?.includes("thinking") ||
    cursorModel.displayName?.toLowerCase().includes("thinking");
  
  return {
    temperature: true,
    reasoning: isThinking,        // 推理模型标记
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false
    },
    interleaved: false
  };
}
```

### 4.5 Token 计数

为了提供准确的 usage 统计，实现了多模型的 token 计数：

```typescript
function calculateTokenUsage(
  text: string,
  modelOwner: string
): { promptTokens: number; completionTokens: number } {
  let count = 0;
  
  if (modelOwner === "anthropic") {
    // Claude 模型使用 Anthropic tokenizer
    count = countTokensAnthropic(text);
  } else if (modelOwner === "openai") {
    // GPT 模型使用 GPT tokenizer
    count = countTokensGPT(text);
  } else {
    // 其他模型使用字符数估算
    count = Math.ceil(text.length / 4);
  }
  
  return {
    promptTokens: count,
    completionTokens: 0
  };
}
```

---

## 5. 数据流

### 5.1 完整对话流程

```
┌──────────┐
│ OpenCode │
└────┬─────┘
     │
     │ 1. POST /v1/chat/completions
     │    { model, messages, stream: true }
     │
     ▼
┌─────────────────────────────┐
│  OpenAI Compat Handler      │
├─────────────────────────────┤
│ - 解析请求                   │
│ - 检查会话重用               │
│ - 解析模型 ID                │
│ - 转换消息格式               │
└────┬────────────────────────┘
     │
     │ 2. AgentRunRequest (Protobuf)
     │
     ▼
┌─────────────────────────────┐
│  Agent Service Client       │
├─────────────────────────────┤
│ - 编码 Protobuf             │
│ - 添加 Connect envelope     │
│ - 发送 RunSSE 请求          │
└────┬────────────────────────┘
     │
     │ 3. POST /aiserver.v1.AgentService/RunSSE
     │    (Connect Protocol + Protobuf)
     │
     ▼
┌─────────────────────────────┐
│  Cursor Agent API           │
└────┬────────────────────────┘
     │
     │ 4. SSE stream
     │    (InteractionUpdate chunks)
     │
     ▼
┌─────────────────────────────┐
│  Agent Service Client       │
├─────────────────────────────┤
│ - 解析 SSE                  │
│ - 移除 envelope             │
│ - 解码 Protobuf             │
│ - 提取内容/工具调用          │
└────┬────────────────────────┘
     │
     │ 5. AgentStreamChunk
     │
     ▼
┌─────────────────────────────┐
│  OpenAI Compat Handler      │
├─────────────────────────────┤
│ - 转换为 OpenAI 格式        │
│ - 格式化 SSE chunk          │
│ - 计算 token usage          │
└────┬────────────────────────┘
     │
     │ 6. data: { choices: [...] }
     │
     ▼
┌──────────┐
│ OpenCode │
└──────────┘
```

### 5.2 工具调用流程

```
Phase 1: 接收工具调用请求
────────────────────────────

SSE: InteractionUpdate (text_delta: "思考中...")
SSE: ExecServerMessage (shell: { command: "ls" })

Phase 2: 执行工具
────────────────

OpenCode executes bash tool
Result: "file1.txt\nfile2.txt\n"

Phase 3: 发送工具结果
────────────────────

POST /aiserver.v1.AgentService/BidiAppend
{
  conversation_id: "...",
  exec_client_message: {
    shell_result: {
      stdout: "file1.txt\nfile2.txt\n",
      stderr: "",
      exit_code: 0
    }
  }
}

Phase 4: 继续对话
───────────────

SSE: InteractionUpdate (text_delta: "找到了两个文件...")
SSE: InteractionUpdate (turn_ended: true)
```

### 5.3 会话重用流程

```
Request 1: 初始请求
──────────────────

messages: [
  { role: "system", content: "Session: session-abc123" },
  { role: "user", content: "Read file.txt" }
]

→ conversation_id: conv-xyz
→ Store: sessionMap.set("session-abc123", { 
    conversationId: "conv-xyz",
    callIds: new Set()
  })

Request 2: 后续请求（工具结果）
────────────────────────────

messages: [
  { role: "system", content: "Session: session-abc123" },
  { role: "user", content: "Read file.txt" },
  { role: "assistant", tool_calls: [...] },
  { role: "tool", content: "file content" }
]

→ Find: session = sessionMap.get("session-abc123")
→ Use: conversation_id = session.conversationId ("conv-xyz")
→ Send: BidiAppend (tool result)

Request 3: 新问题（同一会话）
──────────────────────────

messages: [
  { role: "system", content: "Session: session-abc123" },
  { role: "user", content: "Now modify it" }
]

→ Find: session = sessionMap.get("session-abc123")
→ Use: conversation_id = session.conversationId ("conv-xyz")
→ Send: ConversationAction (resume conversation)
→ 服务器保留之前的上下文，无需重新发送
```

---

## 6. 安全性

### 6.1 认证安全

#### PKCE (Proof Key for Code Exchange)

- 防止授权码拦截攻击
- 使用 SHA-256 哈希保护 code_verifier
- 每次登录生成新的随机参数

#### Token 存储

```typescript
// 存储路径：~/.cursor/credentials/<provider>.json
{
  "type": "oauth",
  "access": "<access_token>",     // 短期 token
  "refresh": "<refresh_token>",   // 长期 token
  "expires": 1234567890000        // 过期时间戳
}

// 文件权限：0600 (仅所有者可读写)
```

#### Token 刷新

- 自动检测 token 过期（提前 60 秒）
- 使用 refresh token 获取新的 access token
- 刷新失败时要求重新登录

### 6.2 请求安全

#### HTTPS Only

所有与 Cursor API 的通信都通过 HTTPS 进行，确保数据传输加密。

#### Header 验证

```typescript
const headers = {
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/connect+proto",
  "Connect-Protocol-Version": "1",
  "User-Agent": "cursor-client/1.0"
};
```

#### 超时控制

```typescript
// 请求超时
const timeout = 300000; // 5 分钟

// 连接空闲超时
const idleTimeout = 120; // 2 分钟

// 会话超时
const sessionTimeout = 15 * 60 * 1000; // 15 分钟
```

### 6.3 数据安全

#### 敏感信息过滤

在日志中过滤敏感信息：

```typescript
function sanitizeLog(data: any): any {
  const sensitive = ["accessToken", "refreshToken", "apiKey", "authorization"];
  
  if (typeof data === "object") {
    for (const key of Object.keys(data)) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        data[key] = "***";
      }
    }
  }
  
  return data;
}
```

#### 错误处理

不在错误消息中泄露敏感信息：

```typescript
try {
  await cursorAPI.call();
} catch (error) {
  // ❌ 不要这样做
  throw new Error(`API call failed: ${error.message}`);
  
  // ✅ 应该这样做
  console.error("API call failed:", error);
  throw new Error("Failed to communicate with Cursor API");
}
```

---

## 7. 性能优化

### 7.1 模型列表缓存

```typescript
interface ModelCache {
  models: CursorModelInfo[] | null;
  time: number;
}

const modelCache: ModelCache = { models: null, time: 0 };
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

async function getCachedModels(accessToken: string): Promise<CursorModelInfo[]> {
  const now = Date.now();
  
  // 检查缓存
  if (modelCache.models && now - modelCache.time < MODEL_CACHE_TTL) {
    return modelCache.models;
  }
  
  // 获取新数据
  const client = new CursorClient(accessToken);
  const models = await listCursorModels(client);
  
  // 更新缓存
  modelCache.models = models;
  modelCache.time = now;
  
  return models;
}
```

### 7.2 会话重用

通过会话重用减少上下文传输：

```typescript
// 不使用会话重用
// 每次请求都需要发送完整对话历史（可能数百 KB）

// 使用会话重用
// 只需要发送新消息和会话 ID（几 KB）

const savings = (fullContextSize - minimalContextSize) / fullContextSize;
// 典型节省：70-90%
```

### 7.3 流式响应

使用流式响应提供即时反馈：

```typescript
// 非流式：用户等待完整响应（可能 10-30 秒）
// 流式：用户立即看到第一个 token（通常 < 1 秒）

const firstTokenLatency = streamMode ? 500 : 15000; // ms
const perceivedPerformance = streamMode ? "fast" : "slow";
```

### 7.4 并发控制

```typescript
// 限制并发请求数
const MAX_CONCURRENT_REQUESTS = 10;
const semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

async function handleRequest(req: Request): Promise<Response> {
  await semaphore.acquire();
  try {
    return await processRequest(req);
  } finally {
    semaphore.release();
  }
}
```

### 7.5 连接复用

```typescript
// 使用 keep-alive 复用 HTTP 连接
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10
});
```

---

## 8. 扩展性

### 8.1 添加新的工具类型

```typescript
// 1. 在 proto/types.ts 定义新工具类型
export interface NewToolRequest {
  param1: string;
  param2: number;
}

// 2. 在 proto/index.ts 添加解析器
export function parseNewToolRequest(data: Uint8Array): NewToolRequest {
  const fields = parseProtoFields(data);
  return {
    param1: decodeStringField(fields.get(1)?.[0]),
    param2: decodeVarintField(fields.get(2)?.[0])
  };
}

// 3. 在 proto/index.ts 添加编码器
export function buildNewToolResult(result: any): Uint8Array {
  return encodeMessage({
    1: encodeStringField(1, result.output)
  });
}

// 4. 在 agent-service.ts 处理新工具
if (execMsg.newTool) {
  const request = parseNewToolRequest(execMsg.newTool);
  // ... 执行工具
  const result = await executeNewTool(request);
  // ... 发送结果
}
```

### 8.2 支持新的模型提供商

```typescript
// 1. 添加模型映射
const MODEL_OWNER_MAP: Record<string, string> = {
  "claude-": "anthropic",
  "gpt-": "openai",
  "gemini-": "google",
  "new-model-": "new-provider"  // 新增
};

// 2. 添加 tokenizer 支持
function getTokenizer(modelOwner: string): Tokenizer {
  switch (modelOwner) {
    case "anthropic": return anthropicTokenizer;
    case "openai": return gptTokenizer;
    case "new-provider": return newProviderTokenizer;  // 新增
    default: return defaultTokenizer;
  }
}

// 3. 添加能力映射
function getModelCapabilities(modelId: string): ModelCapabilities {
  if (modelId.startsWith("new-model-")) {
    return {
      temperature: true,
      reasoning: false,
      // ... 新模型的能力
    };
  }
  // ... 现有逻辑
}
```

### 8.3 插件扩展点

```typescript
// 1. 自定义认证方法
export const CursorOAuthPlugin = async ({ client }: PluginContext) => ({
  auth: {
    provider: CURSOR_PROVIDER_ID,
    methods: [
      // 现有方法
      { label: "OAuth with Cursor", type: "oauth", ... },
      
      // 新增方法
      {
        label: "Custom Auth Method",
        type: "custom",
        authorize: async (inputs) => {
          // 自定义认证逻辑
        }
      }
    ]
  }
});

// 2. 自定义请求拦截器
function createPluginFetch({ accessToken, interceptor }: Options) {
  return async (url: string, init?: RequestInit) => {
    // 应用拦截器
    if (interceptor) {
      init = await interceptor(url, init);
    }
    
    // 执行请求
    return handleRequest(url, init);
  };
}

// 3. 自定义响应处理器
function createAgentServiceClient({
  cursorClient,
  responseHandler
}: Options) {
  return {
    async *chat(request: AgentChatRequest) {
      for await (const chunk of chatStream(request)) {
        // 应用自定义处理器
        const processed = responseHandler 
          ? await responseHandler(chunk)
          : chunk;
        
        yield processed;
      }
    }
  };
}
```

### 8.4 配置扩展

```typescript
// 配置文件：opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cursor-proxy"],
  "provider": {
    "cursor": {
      "name": "Cursor",
      "models": {
        "custom-model": {
          "id": "custom-model",
          "name": "My Custom Model",
          "api": {
            "id": "cursor-model-id",
            "npm": "@ai-sdk/openai-compatible"
          },
          "limit": {
            "context": 200000,
            "output": 8192
          },
          "cost": {
            "input": 0,
            "output": 0
          }
        }
      },
      // 自定义选项
      "options": {
        "sessionReuse": true,
        "cacheModels": true,
        "timeout": 300000
      }
    }
  }
}
```

---

## 附录

### A. 术语表

| 术语 | 说明 |
|------|------|
| **PKCE** | Proof Key for Code Exchange，OAuth 2.0 扩展，用于防止授权码拦截 |
| **BidiSse** | Bidirectional Server-Sent Events，双向流式通信模式 |
| **Connect Protocol** | gRPC-Web 的一种实现，基于 HTTP 的 RPC 协议 |
| **Protobuf** | Protocol Buffers，Google 开发的序列化格式 |
| **SSE** | Server-Sent Events，服务器推送技术 |
| **Varint** | Variable-length integer，可变长度整数编码 |
| **Wire Type** | Protobuf 中的字段类型标识 |
| **Envelope** | Connect Protocol 的消息包装格式 |
| **Agent Mode** | Cursor 的对话模式（CHAT/EDIT） |
| **Session Reuse** | 会话重用，优化多轮对话的上下文管理 |

### B. 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务器端口（独立模式） | `18741` |
| `CURSOR_ACCESS_TOKEN` | 直接提供 access token | - |
| `CURSOR_DEBUG` | 启用调试日志 | `0` |
| `CURSOR_TIMING` | 启用性能计时日志 | `0` |
| `CURSOR_SESSION_REUSE` | 启用会话重用 | `1` |

### C. 错误代码

| 代码 | 说明 | 处理方法 |
|------|------|----------|
| `401` | 认证失败 | 重新登录 |
| `403` | 权限不足 | 检查账户状态 |
| `429` | 请求过多 | 实施限流 |
| `500` | 服务器错误 | 重试请求 |
| `503` | 服务不可用 | 等待后重试 |

### D. 性能指标

| 指标 | 典型值 | 说明 |
|------|--------|------|
| 首 token 延迟 | 500-1500ms | 流式响应的第一个 token 时间 |
| 完整响应时间 | 5-30s | 根据响应长度变化 |
| 工具调用延迟 | 100-500ms | 单个工具调用的往返时间 |
| Token 吞吐量 | 20-50 tokens/s | 流式输出速率 |
| 模型列表缓存 | 5min | 缓存刷新间隔 |
| 会话超时 | 15min | 会话重用的超时时间 |

### E. 参考资源

- [OpenCode Plugin Documentation](https://opencode.ai/docs)
- [Connect Protocol Specification](https://connectrpc.com/docs/protocol)
- [Protocol Buffers Documentation](https://protobuf.dev/)
- [OAuth 2.0 PKCE RFC](https://datatracker.ietf.org/doc/html/rfc7636)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2025-01-18 | 初始版本 |

---

## 贡献者

本技术方案由 OpenCode Cursor Proxy 项目团队编写和维护。

如有问题或建议，请访问 [GitHub Repository](https://github.com/MorseWayne/opencode-cursor-proxy)。
