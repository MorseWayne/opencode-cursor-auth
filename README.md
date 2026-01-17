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
  "plugin": ["opencode-cursor-proxy"],
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

|Variable|Description|Default|
|---|---|---|
|`PORT`|Server port|`18741`|
|`CURSOR_ACCESS_TOKEN`|Provide an access token directly|-|
|`CURSOR_DEBUG`|Enable debug logging|`0`|
|`CURSOR_SESSION_REUSE`|Session reuse for tool-calling|`1`|

## License

MIT
