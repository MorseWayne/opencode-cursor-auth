# Troubleshooting

Common issues and their solutions.

## Authentication Issues

### "Authentication timed out or was cancelled"

**Cause**: The OAuth flow didn't complete within the timeout period.

**Solutions**:

1. Try again - make sure to complete the browser sign-in promptly
2. Check if your browser blocked the popup
3. Ensure you're signed out of Cursor first, then sign in fresh

### "Failed to refresh access token"

**Cause**: The refresh token has expired or been revoked.

**Solutions**:

1. Re-authenticate: `opencode auth login`
2. Select "OAuth with Cursor" and complete the flow again

### "Invalid or expired token"

**Cause**: Access token has expired and couldn't be refreshed.

**Solutions**:

1. Check your internet connection
2. Re-authenticate with `opencode auth login`
3. Ensure your Cursor subscription is active

## Model Discovery Issues

### "No models found"

**Cause**: Failed to fetch model list from Cursor API.

**Solutions**:

1. Check your internet connection
2. Verify authentication is valid
3. Enable debug mode: `CURSOR_DEBUG=1`
4. The plugin will still work with default models

### "Model not available"

**Cause**: The requested model isn't in your Cursor subscription.

**Solutions**:

1. Check available models with `opencode models`
2. Use a model included in your subscription tier
3. Upgrade your Cursor subscription if needed

## API Errors

### "429 Too Many Requests"

**Cause**: Rate limiting from Cursor's API.

**Solutions**:

1. Wait a moment and try again
2. Reduce request frequency
3. Check your Cursor usage limits

### "500 Internal Server Error"

**Cause**: Server-side issue with Cursor's API.

**Solutions**:

1. Wait and retry
2. Check Cursor's status page
3. Try a different model

### "Connection refused"

**Cause**: Can't connect to Cursor's servers.

**Solutions**:

1. Check your internet connection
2. Check if Cursor services are down
3. Verify firewall/proxy settings

## Tool Calling Issues

### "Tool call not completing"

**Cause**: Session state issues with complex tool calls.

**Solutions**:

1. Try disabling session reuse: `CURSOR_SESSION_REUSE=0`
2. Break complex operations into smaller steps
3. Check debug logs: `CURSOR_DEBUG=1`

### "Malformed tool response"

**Cause**: Parsing issue with tool call results.

**Solutions**:

1. Update to the latest plugin version
2. Check for special characters in file paths
3. Report the issue with debug logs

## Installation Issues

### "Plugin not found"

**Cause**: Plugin not properly installed.

**Solutions**:

1. Verify `opencode.json` configuration
2. Run `opencode` to trigger plugin installation
3. Check for npm registry issues

### "Type errors during build"

**Cause**: TypeScript version mismatch.

**Solutions**:

```bash
# Clean install
rm -rf node_modules bun.lock
bun install
```

## Performance Issues

### "Slow response times"

**Solutions**:

1. Check your internet connection
2. Try a faster model (e.g., `sonnet-4.5` instead of `opus-4.5`)
3. Enable session reuse (enabled by default)

### "High memory usage"

**Solutions**:

1. Restart OpenCode periodically
2. Close unused conversations
3. Report if memory grows unbounded

## Debug Mode

Enable debug mode for detailed diagnostics:

```bash
export CURSOR_DEBUG=1
opencode
```

Debug output includes:

- HTTP request/response details
- Token lifecycle events
- Model discovery results
- Error stack traces

## Getting Help

If these solutions don't resolve your issue:

1. **Search existing issues**: [GitHub Issues](https://github.com/MorseWayne/opencode-cursor-proxy/issues)
2. **Open a new issue** with:
   - Description of the problem
   - Steps to reproduce
   - Debug logs (with sensitive info removed)
   - Environment details (OS, versions)

## Known Limitations

1. **Unofficial Integration**: This uses unofficial Cursor APIs that may change
2. **No Guarantees**: Stability depends on Cursor's upstream changes
3. **Account Risk**: May violate Cursor's ToS; use at your own risk
4. **Model Availability**: Depends on your Cursor subscription tier
