# Getting Started

This guide will help you set up and use OpenCode Cursor Proxy.

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A [Cursor](https://cursor.com) account with active subscription
- [Bun](https://bun.sh) (only for development)

## Installation

### As an OpenCode Plugin (Recommended)

1. Add the plugin to your project's `opencode.json`:

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

1. Run OpenCode to install the plugin automatically.

### From Source (Development)

```bash
git clone https://github.com/MorseWayne/opencode-cursor-proxy.git
cd opencode-cursor-proxy
bun install
```

## Authentication

### OAuth Flow (Recommended)

1. Run OpenCode:

```bash
opencode
```

1. Start the authentication flow:

```bash
opencode auth login
```

1. When prompted:
   - Select **"other"** from the provider list
   - Enter **"cursor"** as the provider name
   - Select **"OAuth with Cursor"**

2. Complete the browser-based authentication:
   - A browser window will open automatically
   - Sign in to your Cursor account
   - Authorization will complete automatically

3. Verify authentication:

```bash
opencode auth status
```

### Manual API Key

If OAuth doesn't work for your setup, you can manually enter an API key:

1. Select **"Manually enter API Key"** during auth flow
2. Enter your Cursor API key

## Using the Plugin

Once authenticated, you can use Cursor's AI models in OpenCode:

```bash
# Start OpenCode
opencode

# Select a Cursor model (e.g., sonnet-4.5, opus-4.5, gpt-5.2)
# Models are automatically discovered from Cursor's API
```

### Available Models

The plugin automatically discovers available models from Cursor. Common models include:

| Model | Description |
|-------|-------------|
| `sonnet-4.5` | Claude Sonnet 4.5 |
| `sonnet-4.5-thinking` | Claude Sonnet 4.5 with reasoning |
| `opus-4.5` | Claude Opus 4.5 |
| `opus-4.5-thinking` | Claude Opus 4.5 with reasoning |
| `gpt-5.2` | GPT-5.2 |
| `gpt-5.1-codex` | GPT-5.1 Codex |
| `gemini-3-pro` | Gemini 3 Pro |
| `grok` | Grok 4 |

## Features

### Tool Calling

Full support for OpenCode's tool calling features:

- `bash` - Execute shell commands
- `read` - Read file contents
- `write` - Write files
- `ls` - List directory contents
- `glob` - Find files by pattern
- `grep` - Search file contents

### Streaming

Real-time streaming responses via Server-Sent Events (SSE).

### Session Reuse

Optimized session management for better performance with multiple tool calls.

## Next Steps

- [Configuration Guide](./configuration.md) - Customize your setup
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [Architecture](./development/architecture.md) - Technical deep dive
