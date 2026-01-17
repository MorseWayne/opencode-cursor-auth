# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- Acknowledgment within 48 hours
- Regular updates on the progress
- Credit in the security advisory (if desired)

### Scope

This security policy covers:
- The OpenCode Cursor Proxy codebase
- Authentication and credential handling
- API communication security

### Out of Scope

- Vulnerabilities in Cursor's official services
- Issues in upstream dependencies (report to respective maintainers)
- Social engineering attacks

## Security Best Practices

When using this project:

1. **Protect your credentials**: Never commit or share your Cursor access tokens
2. **Use environment variables**: Store sensitive data in environment variables
3. **Keep dependencies updated**: Regularly update to get security patches
4. **Review permissions**: Understand what access this plugin requires

## Known Security Considerations

### Authentication Tokens

- Access tokens are stored locally using OpenCode's credential storage
- Tokens are automatically refreshed before expiration
- Refresh tokens should be treated as sensitive credentials

### Network Communication

- All API communication uses HTTPS
- The proxy server (if used) runs locally by default

### Data Handling

- This plugin processes your code and conversations
- No data is stored beyond what's needed for the session
- Review Cursor's privacy policy for their data handling practices

## Disclaimer

This is an unofficial, experimental project. Use at your own risk. See the main README for full disclaimers.
