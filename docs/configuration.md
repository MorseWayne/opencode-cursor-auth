# Configuration

This guide covers all configuration options for OpenCode Cursor Proxy.

## OpenCode Configuration

### Basic Setup

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cursor-proxy"],
  "provider": {
    "cursor": {
      "name": "Cursor"
    }
  }
}
```

### Custom Model Configuration

You can customize model settings in your provider configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cursor-proxy"],
  "provider": {
    "cursor": {
      "name": "Cursor",
      "models": {
        "sonnet-4.5": {
          "name": "Claude Sonnet 4.5 (Custom)",
          "limit": {
            "context": 200000,
            "output": 16384
          }
        }
      }
    }
  }
}
```

## Environment Variables

### For Plugin Usage

| Variable | Description | Default |
|----------|-------------|---------|
| `CURSOR_DEBUG` | Enable debug logging | `0` |

### For Standalone Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server listen port | `18741` |
| `CURSOR_ACCESS_TOKEN` | Provide access token directly | - |
| `CURSOR_DEBUG` | Enable debug logging | `0` |
| `CURSOR_SESSION_REUSE` | Enable session reuse for tool calls | `1` |

### Setting Environment Variables

```bash
# Linux/macOS
export CURSOR_DEBUG=1

# Or in .env file (for development)
CURSOR_DEBUG=1
PORT=8080
```

## Authentication Storage

Credentials are stored securely by OpenCode's credential manager:

- **Access Token**: Short-lived token for API calls (auto-refreshed)
- **Refresh Token**: Long-lived token for obtaining new access tokens

### Token Refresh

Access tokens are automatically refreshed:

- Before expiration (60-second buffer)
- On API authentication errors

## Model Limits

The plugin automatically determines model limits from the [llm-info](https://www.npmjs.com/package/llm-info) database. Default limits if not found:

```json
{
  "context": 128000,
  "output": 16384
}
```

### Model Mappings

| Cursor Model | llm-info Model |
|--------------|----------------|
| `sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| `opus-4.5` | `claude-opus-4-5-20251101` |
| `gpt-5.2` | `gpt-5.2` |
| `gpt-5.1` | `gpt-5` |
| `gemini-3-pro` | `gemini-3-pro-preview` |
| `grok` | `grok-4` |

## Advanced Configuration

### Session Reuse

Session reuse optimizes performance for conversations with multiple tool calls by maintaining context across requests.

Disable if you experience issues:

```bash
export CURSOR_SESSION_REUSE=0
```

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
export CURSOR_DEBUG=1
```

This outputs:

- API request/response details
- Token refresh events
- Model discovery information

## Proxy Server Configuration

For development/debugging, you can run the standalone proxy server:

```bash
# Custom port
PORT=9000 bun run server

# With debug logging
CURSOR_DEBUG=1 bun run server

# Disable session reuse
CURSOR_SESSION_REUSE=0 bun run server
```

The proxy server exposes an OpenAI-compatible API at:

- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (streaming and non-streaming)

## Troubleshooting Configuration

See [Troubleshooting](./troubleshooting.md) for common configuration issues.
