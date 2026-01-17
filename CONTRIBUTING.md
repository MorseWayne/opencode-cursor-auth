# Contributing to OpenCode Cursor Proxy

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for all contributors.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (latest version)
- A Cursor account with valid credentials
- Node.js 18+ (for compatibility testing)

### Development Setup

1. Fork and clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/opencode-cursor-proxy.git
cd opencode-cursor-proxy
```

2. Install dependencies:

```bash
bun install
```

3. Authenticate with Cursor:

```bash
bun run auth:login
```

4. Run tests to verify setup:

```bash
bun test
```

## Development Workflow

### Running the Project

```bash
# Start the proxy server (for development)
bun run server

# Run unit tests
bun test tests/unit

# Run integration tests
bun test tests/integration

# Run all tests
bun test
```

### Code Style

- Use TypeScript for all source files
- Follow existing code patterns and naming conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) with Chinese descriptions:

```
feat: 新增功能描述

1. 具体改动点一
2. 具体改动点二
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `style`: Code formatting
- `docs`: Documentation
- `test`: Tests
- `chore`: Build/tooling changes

## Submitting Changes

### Pull Request Process

1. Create a feature branch:

```bash
git checkout -b feat/your-feature-name
```

2. Make your changes and commit them

3. Push to your fork:

```bash
git push origin feat/your-feature-name
```

4. Open a Pull Request against `main`

### PR Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Ensure all tests pass
- Update documentation if needed
- Keep PRs focused and reasonably sized

## Reporting Issues

### Bug Reports

Please include:
- Description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Bun version, etc.)
- Relevant logs or error messages

### Feature Requests

Please include:
- Clear description of the feature
- Use case and motivation
- Any implementation ideas (optional)

## Project Structure

```
opencode-cursor-proxy/
├── src/
│   ├── lib/
│   │   ├── api/          # Cursor API clients
│   │   ├── auth/         # Authentication logic
│   │   ├── openai-compat/ # OpenAI compatibility layer
│   │   └── utils/        # Utility functions
│   ├── plugin/           # OpenCode plugin implementation
│   └── server.ts         # Standalone proxy server
├── tests/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── scripts/              # Development scripts
└── docs/                 # Documentation
```

## Questions?

Feel free to open an issue for any questions or discussions.

Thank you for contributing! 🙏
