# Architecture

Technical overview of OpenCode Cursor Proxy.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenCode                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Plugin System                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │           opencode-cursor-proxy                  │   │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │   │
│  │  │  │   Auth   │  │  Models  │  │ OpenAI Compat│  │   │   │
│  │  │  │  Module  │  │ Discovery│  │    Layer     │  │   │   │
│  │  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │   │   │
│  │  └───────┼─────────────┼───────────────┼──────────┘   │   │
│  └──────────┼─────────────┼───────────────┼──────────────┘   │
└─────────────┼─────────────┼───────────────┼──────────────────┘
              │             │               │
              ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Cursor API                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  OAuth 2.0   │  │   Models     │  │    Agent Service     │  │
│  │   Endpoint   │  │   Endpoint   │  │  (Protobuf/gRPC-web) │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Plugin Entry (`src/plugin/`)

The plugin integrates with OpenCode's plugin system:

```
src/plugin/
├── index.ts      # Export entry point
├── plugin.ts     # Main plugin implementation
└── types.ts      # TypeScript types for plugin API
```

**Key responsibilities:**

- Register authentication provider with OpenCode
- Provide custom fetch function for API interception
- Handle model discovery and configuration

### 2. Authentication (`src/lib/auth/`)

Handles OAuth 2.0 authentication with Cursor:

```
src/lib/auth/
├── index.ts      # Auth module exports
├── login.ts      # OAuth flow management
└── helpers.ts    # Token refresh utilities
```

**OAuth Flow:**

1. Generate PKCE code verifier/challenge
2. Open browser to Cursor's auth endpoint
3. Poll for completion
4. Exchange code for tokens
5. Store tokens securely

### 3. API Client (`src/lib/api/`)

Communicates with Cursor's backend services:

```
src/lib/api/
├── cursor-client.ts    # HTTP client wrapper
├── cursor-models.ts    # Model discovery
├── agent-service.ts    # Agent API (chat completions)
├── ai-service.ts       # AI service utilities
├── openai-compat.ts    # OpenAI compatibility
└── proto/              # Protobuf definitions
```

**Agent Service Protocol:**

- Uses Protocol Buffers for message encoding
- gRPC-web style HTTP transport
- Server-Sent Events for streaming

### 4. OpenAI Compatibility (`src/lib/openai-compat/`)

Translates between OpenAI API format and Cursor's internal API:

```typescript
// OpenAI request format
{
  model: "sonnet-4.5",
  messages: [{ role: "user", content: "Hello" }],
  tools: [{ type: "function", function: { ... } }]
}

// Translated to Cursor's Agent API format internally
```

### 5. Session Reuse (`src/lib/session-reuse.ts`)

Optimizes multi-turn conversations with tool calls:

- Maintains conversation context across requests
- Reduces token usage by avoiding context repetition
- Can be disabled via environment variable

## Data Flow

### Chat Completion Request

```
1. OpenCode sends OpenAI-format request
          │
          ▼
2. Plugin's custom fetch intercepts
          │
          ▼
3. Convert to Cursor Agent API format
          │
          ▼
4. Encode as Protocol Buffer
          │
          ▼
5. Send to Cursor's Agent Service
          │
          ▼
6. Receive streaming response (SSE)
          │
          ▼
7. Decode Protocol Buffer chunks
          │
          ▼
8. Convert to OpenAI SSE format
          │
          ▼
9. Stream back to OpenCode
```

### Token Refresh

```
1. Check token expiration (60s buffer)
          │
          ▼
2. If expired, call refresh endpoint
          │
          ▼
3. Update stored credentials
          │
          ▼
4. Continue with API request
```

## Protocol Buffers

Cursor uses Protocol Buffers for Agent Service communication:

```protobuf
// Simplified representation
message ConversationMessage {
  string type = 1;
  string text = 2;
  repeated ToolCall toolCalls = 3;
  repeated ToolResult toolResults = 4;
}

message AgentRequest {
  string modelName = 1;
  repeated ConversationMessage conversation = 2;
  string userRequest = 3;
}
```

## Security Considerations

### Token Storage

- Tokens stored via OpenCode's secure credential API
- Never logged or exposed in debug output
- Refresh tokens treated as sensitive secrets

### API Communication

- All requests use HTTPS
- Access tokens sent via Authorization header
- No sensitive data in URL parameters

## Testing Strategy

### Unit Tests (`tests/unit/`)

- Token encoding/decoding
- Message format conversion
- Session reuse logic
- Model limit calculations

### Integration Tests (`tests/integration/`)

- API client functionality
- Model discovery
- Tool calling end-to-end

## Extension Points

### Adding New Models

Update `CURSOR_TO_LLM_INFO_MAP` in `plugin.ts`:

```typescript
const CURSOR_TO_LLM_INFO_MAP: Record<string, string> = {
  "new-model": "llm-info-model-id",
  // ...
};
```

### Custom Tool Handling

Extend the OpenAI compatibility layer in `src/lib/openai-compat/`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@bufbuild/protobuf` | Protocol Buffer encoding |
| `llm-info` | Model capability database |
| `gpt-tokenizer` | Token counting |
| `@anthropic-ai/tokenizer` | Claude token counting |

## Future Considerations

1. **Caching**: Response caching for repeated queries
2. **Retry Logic**: Automatic retry with backoff
3. **Metrics**: Usage tracking and analytics
4. **Multi-account**: Support multiple Cursor accounts
