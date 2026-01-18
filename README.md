# OpenCode Cursor Proxy

**English** | [中文](README.zh-CN.md)

> **Disclaimer**
>
> This is an **experimental** community project that integrates with Cursor via **unofficial** interfaces.
>
> - **May break at any time** if Cursor changes upstream behavior
> - **No guarantees** on stability, compatibility, or long-term support
> - **Not affiliated with / endorsed by Cursor**
> - May violate [Cursor Terms of Service](https://www.cursor.com/terms-of-service); **your account could be suspended/terminated**
>
> By using this project, you acknowledge these risks and accept full responsibility. For educational and research purposes only.

An OpenCode plugin that lets you use Cursor's AI backend with **OAuth authentication**, **dynamic model discovery**, and **full tool-calling support**.

## Documentation

- 🚀 [Getting Started](docs/getting-started.md) - Installation and setup guide
- ⚙️ [Configuration](docs/configuration.md) - All configuration options
- 🔧 [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions
- 🏗️ [Architecture](docs/development/architecture.md) - Technical deep dive

## Features

- **OpenCode plugin integration** via OAuth
- **Full tool-calling support** (bash/read/write/ls/glob/grep, etc.)
- **Dynamic model discovery** from Cursor APIs
- **Streaming support** via SSE

## Quick start (OpenCode plugin)

### 1) Configure `opencode.json`

Add the plugin and provider to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-cursor-proxy@latest"],
  "provider": {
    "cursor": { "name": "Cursor" }
  }
}
```

### 2) Authenticate

Run OpenCode and authenticate:

```bash
opencode auth login
```

Then:

1. Select **"other"** from the provider list
2. Enter **"cursor"** as the provider name
3. Select **"OAuth with Cursor"**
4. Complete the browser-based OAuth flow

## Standalone proxy server (optional, for development)

> The standalone proxy server is primarily a dev artifact for testing/debugging. Most users should prefer the OpenCode plugin flow above.

### Prerequisites

- [Bun](https://bun.sh)
- A Cursor account with valid credentials

### Run

```bash
git clone https://github.com/MorseWayne/opencode-cursor-proxy.git
cd opencode-cursor-proxy
bun install

# authenticate (script name is auth)
bun run auth:login

# start server
bun run server
```

Default listen address: `http://localhost:18741`

### Environment variables

#### Basic

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `18741` |
| `HOST` | Server host | `localhost` |
| `CURSOR_ACCESS_TOKEN` | Provide an access token directly | - |

#### Debug & Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `CURSOR_DEBUG` | Enable debug logging | `0` |
| `CURSOR_TIMING` | Enable performance timing logs | `0` |
| `CURSOR_LOG_LEVEL` | Log level: `error`, `warn`, `info`, `debug` | `info` |
| `CURSOR_LOG_JSON` | Output logs in JSON format | `0` |
| `CURSOR_REQUEST_LOGGING` | Enable request/response logging | `0` |
| `CURSOR_LOG_FILTERED_IDS` | Log filtered message IDs | `0` |
| `CURSOR_LOG_MULTIMODAL` | Log multimodal content detection | `0` |

#### Session & Cache

| Variable | Description | Default |
|----------|-------------|---------|
| `CURSOR_SESSION_REUSE` | Enable session reuse for tool-calling | `1` |
| `CURSOR_SESSION_TIMEOUT_MS` | Session timeout (ms) | `900000` (15min) |
| `CURSOR_MAX_SESSIONS` | Maximum cached sessions | `100` |
| `CURSOR_MODEL_CACHE_TTL_MS` | Model cache TTL (ms) | `300000` (5min) |

#### Network

| Variable | Description | Default |
|----------|-------------|---------|
| `CURSOR_REQUEST_TIMEOUT_MS` | Request timeout (ms) | `120000` (2min) |
| `CURSOR_MAX_RETRIES` | Max retry attempts | `3` |
| `CURSOR_RETRY_ENABLED` | Enable automatic retry | `1` |
| `CURSOR_RETRY_BASE_DELAY_MS` | Base delay for exponential backoff (ms) | `1000` |
| `CURSOR_RETRY_MAX_DELAY_MS` | Max delay between retries (ms) | `30000` |

#### API

| Variable | Description | Default |
|----------|-------------|---------|
| `CURSOR_API_URL` | Cursor API base URL | `https://api2.cursor.sh` |
| `CURSOR_PRIVACY_MODE` | Enable privacy mode | `1` |
| `CURSOR_CLIENT_VERSION` | Override client version header | - |

## License

MIT
