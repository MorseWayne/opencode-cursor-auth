# OpenCode Cursor Proxy Technical Design

**English** | [中文](TECHNICAL_DESIGN.zh-CN.md)

## Table of Contents

- [1. Project Overview](#1-project-overview)
- [2. System Architecture](#2-system-architecture)
- [3. Core Technologies](#3-core-technologies)
- [4. Implementation Details](#4-implementation-details)
- [5. Data Flow](#5-data-flow)
- [6. Security](#6-security)
- [7. Performance Optimization](#7-performance-optimization)
- [8. Extensibility](#8-extensibility)

---

## 1. Project Overview

### 1.1 Project Positioning

OpenCode Cursor Proxy is an OpenCode plugin that enables users to leverage Cursor's AI backend services within OpenCode. The project integrates with Cursor services through unofficial interfaces, providing complete AI conversation, tool calling, and streaming response capabilities.

### 1.2 Core Capabilities

- **OpenCode Plugin Integration**: Native integration with OpenCode via OAuth authentication
- **Full Tool Calling Support**: Supports bash, read, write, list, glob, grep, and other function calls
- **Dynamic Model Discovery**: Automatically fetches available model lists from Cursor's API
- **Streaming Responses**: Real-time streaming responses via SSE (Server-Sent Events)
- **Session Reuse**: Optimizes performance and context management for tool calling scenarios
- **Standalone Proxy Server**: Optional standalone server mode for testing and debugging

### 1.3 Technology Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Protocol**: gRPC-Web (Connect Protocol) + SSE
- **Encoding**: Protocol Buffers
- **Authentication**: OAuth 2.0 with PKCE

---

## 2. System Architecture

### 2.1 Overall Architecture Diagram

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

### 2.2 Module Structure

```
src/
├── index.ts                    # Plugin entry point
├── server.ts                   # Standalone server (optional)
├── plugin/                     # OpenCode plugin module
│   ├── plugin.ts              # Plugin main logic
│   ├── types.ts               # Type definitions
│   └── index.ts               # Exports
├── lib/
│   ├── api/                   # Cursor API clients
│   │   ├── cursor-client.ts   # Base HTTP client
│   │   ├── agent-service.ts   # Agent service (chat/tool calling)
│   │   ├── ai-service.ts      # AI service (model list)
│   │   ├── cursor-models.ts   # Model management
│   │   └── proto/             # Protobuf encode/decode
│   ├── auth/                  # Authentication module
│   │   ├── login.ts           # OAuth PKCE login
│   │   ├── helpers.ts         # Token refresh
│   │   └── index.ts           # Exports
│   ├── openai-compat/         # OpenAI API compatibility layer
│   │   ├── handler.ts         # Request handler
│   │   ├── utils.ts           # Utility functions
│   │   ├── types.ts           # Type definitions
│   │   └── index.ts           # Exports (includes fetch function)
│   ├── utils/                 # Utility functions
│   │   ├── tokenizer.ts       # Token counting
│   │   └── jwt.ts             # JWT parsing
│   ├── storage.ts             # Credential storage
│   └── session-reuse.ts       # Session reuse management
└── scripts/                   # CLI tools
    ├── auth.ts                # Authentication management
    └── fetch-models.ts        # Model list fetching
```

---

## 3. Core Technologies

### 3.1 OAuth 2.0 with PKCE Authentication

#### Authentication Flow

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

#### PKCE Parameter Generation

```typescript
// 1. Generate 32-byte random verifier
const verifier = base64URLEncode(randomBytes(32));

// 2. Calculate SHA-256 challenge
const challenge = base64URLEncode(sha256(verifier));

// 3. Generate unique UUID
const uuid = randomUUID();

// 4. Construct login URL
const loginUrl = `https://cursor.com/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login&redirectTarget=cli`;
```

#### Token Management

- **Access Token**: Used for API calls, expires in ~1 hour
- **Refresh Token**: Used to refresh access token, long-lived
- **Auto Refresh**: Detects token expiration and auto-refreshes (60 seconds buffer)
- **Persistent Storage**: Tokens stored in local filesystem

### 3.2 BidiSse Protocol

Cursor's Agent API uses gRPC-Web (Connect Protocol) in BidiSse mode, a special implementation of bidirectional streaming communication.

#### Protocol Characteristics

- **Bidirectional Communication**: Both client and server can send multiple messages
- **Streaming Receive**: Uses SSE (Server-Sent Events) to receive server messages
- **Separate Send**: Uses HTTP POST to send client messages

#### Request Flow

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

#### Protobuf Message Structure

**AgentClientMessage**:

```protobuf
message AgentClientMessage {
  optional AgentRunRequest run_request = 1;              // Initial request
  optional ExecClientMessage exec_client_message = 2;    // Tool execution result
  optional KvClientMessage kv_client_message = 3;        // Key-value message
  optional ConversationAction conversation_action = 4;    // Conversation action
  optional ExecClientControlMessage exec_client_control_message = 5;
  optional InteractionResponse interaction_response = 6;
}
```

**AgentServerMessage**:

```protobuf
message AgentServerMessage {
  optional InteractionUpdate interaction_update = 1;         // Conversation update
  optional ExecServerMessage exec_server_message = 2;        // Tool call request
  optional ConversationCheckpoint conversation_checkpoint_update = 3; // Completion signal
  optional KvServerMessage kv_server_message = 4;            // Key-value message
  optional ExecServerControlMessage exec_server_control_message = 5;
  optional InteractionQuery interaction_query = 7;           // Interaction query
}
```

**InteractionUpdate.message**:

```protobuf
message InteractionUpdateMessage {
  optional string text_delta = 1;       // Text delta
  optional string thinking_delta = 4;   // Thinking process delta
  optional int32 token_delta = 8;       // Token count delta
  optional bool heartbeat = 13;         // Heartbeat
  optional bool turn_ended = 14;        // Turn ended
}
```

### 3.3 OpenAI API Compatibility Layer

#### Request Transformation

OpenAI Format → Cursor Agent Format

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

// ↓ Transforms to

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

#### Response Transformation

Cursor Agent Format → OpenAI SSE Format

```typescript
// Cursor InteractionUpdate
{
  interaction_update: {
    message: {
      text_delta: "Hello "
    }
  }
}

// ↓ Transforms to

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

### 3.4 Tool Calling Mechanism

#### Supported Tool Types

1. **Shell Commands** (`bash`)
   - Execute system commands
   - Return stdout and stderr

2. **File Reading** (`read`)
   - Read file contents
   - Support line range limits

3. **File Writing** (`write`)
   - Create or modify files
   - Support string replacement

4. **Directory Listing** (`list`)
   - List directory contents
   - Support recursion and filtering

5. **File Search** (`glob`)
   - Pattern-based file matching

6. **Content Search** (`grep`)
   - Search text in files
   - Support regular expressions

7. **MCP Tools** (`mcp`)
   - Support Model Context Protocol tools

#### Tool Calling Flow

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

### 3.5 Session Reuse

#### Design Goals

- Reduce redundant context transmission
- Optimize multi-turn tool calling performance
- Maintain conversation continuity

#### Implementation Mechanism

```typescript
// 1. Session ID generation
const sessionId = createSessionId(); // Format: "session-<uuid>"

// 2. Inject session ID on first request
messages = [
  {
    role: "system",
    content: `Session: ${sessionId}`
  },
  ...userMessages
];

// 3. Recognize session ID on subsequent requests
const existingSessionId = findSessionIdInMessages(messages);

// 4. Session management
sessionMap.set(sessionId, {
  conversationId,
  callIds: new Set(),
  lastAccessTime: Date.now()
});

// 5. Auto cleanup expired sessions (15 minutes)
cleanupExpiredSessions(sessionMap, SESSION_TIMEOUT_MS);
```

---

## 4. Implementation Details

### 4.1 Connect Protocol Implementation

Cursor API uses Connect Protocol, an HTTP-based RPC protocol for gRPC-Web.

#### Request Format

```http
POST /aiserver.v1.AgentService/RunSSE HTTP/1.1
Host: api2.cursor.sh
Content-Type: application/connect+proto
Connect-Protocol-Version: 1
Connect-Timeout-Ms: 300000
Authorization: Bearer <access_token>

[Protobuf encoded message]
```

#### Response Format (SSE)

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked

data: <base64-encoded-protobuf>

data: <base64-encoded-protobuf>

data: <base64-encoded-protobuf>

data: [DONE]
```

#### Connect Envelope Encoding

Connect Protocol uses a special envelope format to wrap Protobuf messages:

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

### 4.2 Protobuf Encoding/Decoding

Since Cursor's Protobuf schema is private, we've implemented the necessary encode/decode functionality through reverse engineering.

#### Basic Encoding Functions

```typescript
// Varint encoding (for field numbers and lengths)
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

// Field encoding
function encodeField(fieldNumber: number, wireType: number, value: Uint8Array): Uint8Array {
  const tag = (fieldNumber << 3) | wireType;
  const tagBytes = encodeVarint(tag);
  return concat(tagBytes, value);
}

// String field
function encodeStringField(fieldNumber: number, value: string): Uint8Array {
  const valueBytes = new TextEncoder().encode(value);
  const lengthBytes = encodeVarint(valueBytes.length);
  return encodeField(fieldNumber, 2, concat(lengthBytes, valueBytes));
}
```

### 4.3 Streaming Response Handling

#### SSE Parser

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

### 4.4 Model Discovery and Mapping

#### Cursor Model Fetching

```typescript
async function listCursorModels(client: CursorClient): Promise<CursorModelInfo[]> {
  const response = await client.aiService.GetModels({});
  
  return response.models.map(model => ({
    modelId: model.modelId,              // Internal ID (for API calls)
    displayModelId: model.displayModelId, // Display ID (user-facing)
    displayName: model.displayName,       // Display name
    displayNameShort: model.displayNameShort,
    aliases: model.aliases || [],         // Alias list
    capabilities: model.capabilities
  }));
}
```

### 4.5 Token Counting

For accurate usage statistics, multi-model token counting is implemented:

```typescript
function calculateTokenUsage(
  text: string,
  modelOwner: string
): { promptTokens: number; completionTokens: number } {
  let count = 0;
  
  if (modelOwner === "anthropic") {
    // Claude models use Anthropic tokenizer
    count = countTokensAnthropic(text);
  } else if (modelOwner === "openai") {
    // GPT models use GPT tokenizer
    count = countTokensGPT(text);
  } else {
    // Other models use character-based estimation
    count = Math.ceil(text.length / 4);
  }
  
  return {
    promptTokens: count,
    completionTokens: 0
  };
}
```

---

## 5. Data Flow

### 5.1 Complete Conversation Flow

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
│ - Parse request             │
│ - Check session reuse       │
│ - Resolve model ID          │
│ - Convert message format    │
└────┬────────────────────────┘
     │
     │ 2. AgentRunRequest (Protobuf)
     │
     ▼
┌─────────────────────────────┐
│  Agent Service Client       │
├─────────────────────────────┤
│ - Encode Protobuf           │
│ - Add Connect envelope      │
│ - Send RunSSE request       │
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
│ - Parse SSE                 │
│ - Remove envelope           │
│ - Decode Protobuf           │
│ - Extract content/tool calls│
└────┬────────────────────────┘
     │
     │ 5. AgentStreamChunk
     │
     ▼
┌─────────────────────────────┐
│  OpenAI Compat Handler      │
├─────────────────────────────┤
│ - Convert to OpenAI format  │
│ - Format SSE chunk          │
│ - Calculate token usage     │
└────┬────────────────────────┘
     │
     │ 6. data: { choices: [...] }
     │
     ▼
┌──────────┐
│ OpenCode │
└──────────┘
```

---

## 6. Security

### 6.1 Authentication Security

#### PKCE (Proof Key for Code Exchange)

- Prevents authorization code interception attacks
- Uses SHA-256 hash to protect code_verifier
- Generates new random parameters for each login

#### Token Storage

```typescript
// Storage path: ~/.cursor/credentials/<provider>.json
{
  "type": "oauth",
  "access": "<access_token>",     // Short-lived token
  "refresh": "<refresh_token>",   // Long-lived token
  "expires": 1234567890000        // Expiration timestamp
}

// File permissions: 0600 (owner read/write only)
```

### 6.2 Request Security

#### HTTPS Only

All communication with Cursor API uses HTTPS to ensure data transmission encryption.

#### Timeout Controls

```typescript
// Request timeout
const timeout = 300000; // 5 minutes

// Idle timeout
const idleTimeout = 120; // 2 minutes

// Session timeout
const sessionTimeout = 15 * 60 * 1000; // 15 minutes
```

---

## 7. Performance Optimization

### 7.1 Model List Caching

```typescript
interface ModelCache {
  models: CursorModelInfo[] | null;
  time: number;
}

const modelCache: ModelCache = { models: null, time: 0 };
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedModels(accessToken: string): Promise<CursorModelInfo[]> {
  const now = Date.now();
  
  // Check cache
  if (modelCache.models && now - modelCache.time < MODEL_CACHE_TTL) {
    return modelCache.models;
  }
  
  // Fetch new data
  const client = new CursorClient(accessToken);
  const models = await listCursorModels(client);
  
  // Update cache
  modelCache.models = models;
  modelCache.time = now;
  
  return models;
}
```

### 7.2 Session Reuse

Reduce context transmission through session reuse:

```typescript
// Without session reuse
// Every request needs to send full conversation history (potentially hundreds of KB)

// With session reuse
// Only need to send new message and session ID (few KB)

const savings = (fullContextSize - minimalContextSize) / fullContextSize;
// Typical savings: 70-90%
```

### 7.3 Streaming Responses

Use streaming responses for immediate feedback:

```typescript
// Non-streaming: User waits for complete response (possibly 10-30 seconds)
// Streaming: User sees first token immediately (typically < 1 second)

const firstTokenLatency = streamMode ? 500 : 15000; // ms
const perceivedPerformance = streamMode ? "fast" : "slow";
```

---

## 8. Extensibility

### 8.1 Adding New Tool Types

```typescript
// 1. Define new tool type in proto/types.ts
export interface NewToolRequest {
  param1: string;
  param2: number;
}

// 2. Add parser in proto/index.ts
export function parseNewToolRequest(data: Uint8Array): NewToolRequest {
  const fields = parseProtoFields(data);
  return {
    param1: decodeStringField(fields.get(1)?.[0]),
    param2: decodeVarintField(fields.get(2)?.[0])
  };
}

// 3. Add encoder in proto/index.ts
export function buildNewToolResult(result: any): Uint8Array {
  return encodeMessage({
    1: encodeStringField(1, result.output)
  });
}

// 4. Handle new tool in agent-service.ts
if (execMsg.newTool) {
  const request = parseNewToolRequest(execMsg.newTool);
  // ... execute tool
  const result = await executeNewTool(request);
  // ... send result
}
```

### 8.2 Supporting New Model Providers

```typescript
// 1. Add model mapping
const MODEL_OWNER_MAP: Record<string, string> = {
  "claude-": "anthropic",
  "gpt-": "openai",
  "gemini-": "google",
  "new-model-": "new-provider"  // New
};

// 2. Add tokenizer support
function getTokenizer(modelOwner: string): Tokenizer {
  switch (modelOwner) {
    case "anthropic": return anthropicTokenizer;
    case "openai": return gptTokenizer;
    case "new-provider": return newProviderTokenizer;  // New
    default: return defaultTokenizer;
  }
}
```

---

## Appendix

### A. Glossary

| Term | Description |
|------|-------------|
| **PKCE** | Proof Key for Code Exchange, OAuth 2.0 extension for preventing authorization code interception |
| **BidiSse** | Bidirectional Server-Sent Events, bidirectional streaming communication mode |
| **Connect Protocol** | An implementation of gRPC-Web, HTTP-based RPC protocol |
| **Protobuf** | Protocol Buffers, serialization format developed by Google |
| **SSE** | Server-Sent Events, server push technology |
| **Varint** | Variable-length integer encoding |
| **Wire Type** | Field type identifier in Protobuf |
| **Envelope** | Message wrapper format in Connect Protocol |
| **Agent Mode** | Cursor's conversation mode (CHAT/EDIT) |
| **Session Reuse** | Optimization for context management in multi-turn conversations |

### B. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port (standalone mode) | `18741` |
| `CURSOR_ACCESS_TOKEN` | Directly provide access token | - |
| `CURSOR_DEBUG` | Enable debug logging | `0` |
| `CURSOR_TIMING` | Enable performance timing logs | `0` |
| `CURSOR_SESSION_REUSE` | Enable session reuse | `1` |

### C. Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `401` | Authentication failed | Re-login |
| `403` | Insufficient permissions | Check account status |
| `429` | Too many requests | Implement rate limiting |
| `500` | Server error | Retry request |
| `503` | Service unavailable | Wait and retry |

### D. Performance Metrics

| Metric | Typical Value | Description |
|--------|---------------|-------------|
| First token latency | 500-1500ms | Time to first token in streaming response |
| Full response time | 5-30s | Varies based on response length |
| Tool call latency | 100-500ms | Round-trip time for single tool call |
| Token throughput | 20-50 tokens/s | Streaming output rate |
| Model list cache | 5min | Cache refresh interval |
| Session timeout | 15min | Session reuse timeout |

### E. References

- [OpenCode Plugin Documentation](https://opencode.ai/docs)
- [Connect Protocol Specification](https://connectrpc.com/docs/protocol)
- [Protocol Buffers Documentation](https://protobuf.dev/)
- [OAuth 2.0 PKCE RFC](https://datatracker.ietf.org/doc/html/rfc7636)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2025-01-18 | Initial version |

---

## Contributors

This technical design document is written and maintained by the OpenCode Cursor Proxy project team.

For questions or suggestions, please visit the [GitHub Repository](https://github.com/MorseWayne/opencode-cursor-proxy).
