# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-01-18

### Added

- OpenCode plugin integration with OAuth authentication
- Full tool-calling support (bash, read, write, ls, glob, grep, etc.)
- Dynamic model discovery from Cursor APIs
- Streaming support via SSE
- Session reuse for improved tool-calling performance
- Standalone proxy server for development and debugging
- Unit tests and integration tests
- Bilingual documentation (English and Chinese)

### Features

- **OAuth Authentication**: Browser-based OAuth flow with PKCE for secure authentication
- **Token Refresh**: Automatic access token refresh using refresh tokens
- **Model Mapping**: Intelligent mapping between Cursor models and llm-info for accurate token limits
- **OpenAI Compatibility**: Full OpenAI API compatibility layer for seamless integration

## [0.1.0] - 2026-01-15

### Added

- Initial project setup
- Basic Cursor API client implementation
- Protobuf-based Agent Service communication
- Core authentication flow

[Unreleased]: https://github.com/MorseWayne/opencode-cursor-proxy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MorseWayne/opencode-cursor-proxy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MorseWayne/opencode-cursor-proxy/releases/tag/v0.1.0
