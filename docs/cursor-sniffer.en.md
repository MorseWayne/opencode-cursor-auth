# Cursor Traffic Sniffer & Analyzer

A debugging tool for intercepting and analyzing communication between Cursor client and Cursor API servers.

[中文文档](./cursor-sniffer.md)

## Features

- **Traffic Interception**: Runs as an HTTP proxy to intercept Cursor ↔ `api2.cursor.sh` communication
- **Protobuf Parsing**: Automatically parses gRPC-Web + Protobuf formatted messages
- **Message Analysis**: Identifies and formats various message types (chat requests, tool calls, KV storage, etc.)
- **Interactive Mode**: Manually input protobuf data for analysis
- **Pipe Analysis**: Analyze data from other tools via stdin

## Installation & Running

### Prerequisites

- Bun runtime
- Project dependencies installed (`bun install`)

### Running

```bash
# Start proxy server (default port 8888)
bun run sniffer

# Start proxy server (verbose output)
bun run sniffer:verbose

# Start interactive analysis mode
bun run sniffer:interactive

# Run script directly
bun run scripts/cursor-sniffer.ts [options]
```

## Usage Modes

### Mode 1: Proxy Server

Run as an HTTP proxy to intercept Cursor client traffic.

```bash
# Terminal 1: Start proxy
bun run sniffer --port 8888 --verbose

# Terminal 2: Configure Cursor to use proxy
export HTTP_PROXY=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
cursor .
```

**Command Line Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Proxy server port | 8888 |
| `--output <file>` | Save captured traffic to file | - |
| `--verbose, -v` | Show full message content | false |
| `--raw, -r` | Show raw hex data | false |

**Note**: For HTTPS traffic interception, you need to set up certificate trust. Consider using [mitmproxy](https://mitmproxy.org/) for complete HTTPS interception.

### Mode 2: Interactive Analysis

Manually input protobuf data for analysis.

```bash
bun run sniffer:interactive
```

**Available Commands**:

```
> hex 0a0568656c6c6f          # Analyze hex-encoded protobuf
> b64 CgVoZWxsbw==            # Analyze base64-encoded protobuf
> file /path/to/data.bin      # Analyze protobuf data from file
> q                           # Quit
```

**Example Session**:

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

### Mode 3: Pipe Analysis

Read data from stdin for analysis, suitable for use with other tools.

```bash
# Analyze hex data
echo "0a0568656c6c6f" | bun run scripts/cursor-sniffer.ts --analyze

# Analyze base64 data
echo "CgVoZWxsbw==" | bun run scripts/cursor-sniffer.ts --analyze-base64

# Use with mitmproxy
# 1. Capture traffic with mitmproxy and export
# 2. Extract protobuf data
# 3. Analyze
cat captured.bin | xxd -p | tr -d '\n' | bun run scripts/cursor-sniffer.ts --analyze
```

## Output Format

### Request Analysis

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
        "text": "Help me write a hello world program",
        "mode": 1
      }
    },
    "model": "claude-sonnet-4.5",
    "conversationId": "abc123..."
  }
```

### Response Analysis

```
── RESPONSE /aiserver.v1.AgentService/RunSSE ──
  InteractionUpdate: text
    "Sure, I'll help you write a hello world program..."
  InteractionUpdate: tool_call_started
    {"callId": "call_123", "name": "write", "arguments": "..."}
  ExecServerMessage: shell
    {"id": 1, "command": "echo 'hello world'", "cwd": "/home/user"}
  Checkpoint: conversation_checkpoint
  InteractionUpdate: turn_ended
```

## Supported Message Types

### AgentClientMessage (Client → Server)

| Field # | Type | Description |
|---------|------|-------------|
| 1 | AgentRunRequest | Initial chat request |
| 2 | ExecClientMessage | Tool execution result |
| 3 | KvClientMessage | KV storage operation |
| 4 | ConversationAction | Conversation control (e.g., resume) |
| 5 | ExecClientControlMessage | Execution control message |

### AgentServerMessage (Server → Client)

| Field # | Type | Description |
|---------|------|-------------|
| 1 | InteractionUpdate | Conversation update (text/thinking/tool calls) |
| 2 | ExecServerMessage | Tool execution request |
| 3 | Checkpoint | Conversation checkpoint |
| 4 | KvServerMessage | KV storage message |
| 5 | ExecServerControlMessage | Execution control message (e.g., abort) |
| 7 | InteractionQuery | Interaction query |

### InteractionUpdate Subtypes

| Field # | Type | Description |
|---------|------|-------------|
| 1 | text_delta | Text increment |
| 2 | tool_call_started | Tool call started |
| 3 | tool_call_completed | Tool call completed |
| 4 | thinking_delta | Thinking process increment (reasoning models) |
| 7 | partial_tool_call | Partial tool call |
| 8 | token_delta | Token increment |
| 13 | heartbeat | Heartbeat |
| 14 | turn_ended | Turn ended |

### ExecServerMessage Types

| Type | Description |
|------|-------------|
| shell | Shell command execution |
| read | File read |
| write | File write |
| ls | Directory listing |
| grep | Content search |
| mcp | MCP tool call |

## Using with mitmproxy

For complete HTTPS traffic interception, use mitmproxy:

```bash
# 1. Install mitmproxy
pip install mitmproxy

# 2. Start mitmproxy
mitmproxy -p 8080

# 3. Install CA certificate (first time only)
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem

# Linux
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt
sudo update-ca-certificates

# 4. Configure Cursor to use proxy
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
cursor .
```

Then view traffic in mitmproxy, or export for analysis with this tool.

## Use Cases

### 1. Debugging Protocol Issues

When the plugin has communication issues with Cursor API, use this tool to see actual data sent and received.

```bash
# Enable verbose mode
bun run sniffer:verbose
```

### 2. Analyzing New Message Types

When encountering unknown protobuf fields, use raw mode to view data:

```bash
bun run scripts/cursor-sniffer.ts --verbose --raw
```

### 3. Reverse Engineering

Analyze Cursor client's communication protocol to extend plugin functionality:

```bash
# Start interactive mode to manually analyze captured data
bun run sniffer:interactive

> hex [hex data copied from mitmproxy]
```

### 4. Verifying Encoding Implementation

Check if protobuf messages generated by the plugin are correct:

```bash
# Add hex output logging in code
console.log(Buffer.from(message).toString('hex'));

# Then analyze
echo "hex output" | bun run scripts/cursor-sniffer.ts --analyze
```

## Technical Details

### Connect Protocol Envelope Format

Each gRPC-Web message has a 5-byte envelope:

```
[flags: 1 byte] [length: 4 bytes big-endian] [protobuf payload]
```

This tool automatically removes the envelope and parses the payload.

### Protobuf Wire Types

| Wire Type | Meaning | Encoding |
|-----------|---------|----------|
| 0 | Varint | Variable-length integer |
| 1 | 64-bit | Fixed 8 bytes |
| 2 | Length-delimited | Length prefix + data |
| 5 | 32-bit | Fixed 4 bytes |

### SSE Response Format

Cursor API uses Server-Sent Events to return streaming responses:

```
data: [base64-encoded protobuf with envelope]

data: [base64-encoded protobuf with envelope]

data: [DONE]
```

## Troubleshooting

### Proxy Connection Failure

Ensure Cursor has proxy environment variables correctly configured:

```bash
# Check environment variables
echo $HTTP_PROXY
echo $HTTPS_PROXY

# Test proxy connection
curl -x http://127.0.0.1:8888 https://api2.cursor.sh/
```

### Certificate Trust Issues

For HTTPS interception, you need to trust the proxy's CA certificate:

```bash
# When using mitmproxy
export NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem
```

### Parse Errors

If you encounter parse errors, try using raw mode to view data:

```bash
bun run scripts/cursor-sniffer.ts --raw

# Or in interactive mode
> hex [data]
```

## Related Documentation

- [Technical Design Document](./technical-design.md) - Complete protocol implementation details
- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions
- [mitmproxy Documentation](https://docs.mitmproxy.org/) - Complete HTTPS interception tool
