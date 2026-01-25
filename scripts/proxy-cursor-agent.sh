#!/bin/bash
#
# proxy-cursor-agent.sh - Run cursor-agent through mitmproxy
#
# This script properly configures cursor-agent to route all traffic
# through mitmproxy for analysis, including:
# - TLS certificate trust (NODE_EXTRA_CA_CERTS)
# - Force proxy via proxychains (cursor-agent ignores HTTP_PROXY)
#
# Usage:
#   ./scripts/proxy-cursor-agent.sh [cursor-agent args...]
#
# Examples:
#   ./scripts/proxy-cursor-agent.sh --print "Hello"
#   ./scripts/proxy-cursor-agent.sh
#

set -e

# Configuration
MITMPROXY_PORT="${MITMPROXY_PORT:-8080}"
PROXYCHAINS_CONF="${PROXYCHAINS_CONF:-$HOME/.proxychains.conf}"
MITMPROXY_CA="${MITMPROXY_CA:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=== Cursor Agent Proxy Wrapper ===${NC}"

# Check if mitmproxy CA exists
if [ ! -f "$MITMPROXY_CA" ]; then
    echo -e "${RED}Error: mitmproxy CA certificate not found at $MITMPROXY_CA${NC}"
    echo "Please run mitmproxy first to generate the certificate:"
    echo "  mitmdump -p $MITMPROXY_PORT"
    exit 1
fi

# Check if proxychains is installed
if ! command -v proxychains4 &> /dev/null; then
    echo -e "${YELLOW}Warning: proxychains4 not found${NC}"
    echo "Install with: sudo apt install proxychains4"
    echo ""
    echo "Falling back to HTTP_PROXY (may not work for all requests)..."
    
    # Fallback to HTTP_PROXY
    export HTTP_PROXY="http://127.0.0.1:$MITMPROXY_PORT"
    export HTTPS_PROXY="http://127.0.0.1:$MITMPROXY_PORT"
    export NODE_EXTRA_CA_CERTS="$MITMPROXY_CA"
    
    echo -e "${GREEN}Running cursor-agent with HTTP_PROXY...${NC}"
    exec cursor-agent "$@"
fi

# Create proxychains config if it doesn't exist
if [ ! -f "$PROXYCHAINS_CONF" ]; then
    echo -e "${YELLOW}Creating proxychains config at $PROXYCHAINS_CONF${NC}"
    cat > "$PROXYCHAINS_CONF" << EOF
# Proxychains configuration for Cursor traffic analysis
strict_chain
proxy_dns
remote_dns_subnet 224

# Don't proxy local connections (important!)
localnet 127.0.0.0/255.0.0.0
localnet ::1/128

[ProxyList]
http 127.0.0.1 $MITMPROXY_PORT
EOF
    echo -e "${GREEN}Created $PROXYCHAINS_CONF${NC}"
fi

# Check if mitmproxy is running
if ! nc -z 127.0.0.1 "$MITMPROXY_PORT" 2>/dev/null; then
    echo -e "${RED}Error: mitmproxy is not running on port $MITMPROXY_PORT${NC}"
    echo "Start mitmproxy first:"
    echo "  mitmdump -s scripts/mitmproxy-addon.py -p $MITMPROXY_PORT --set stream_large_bodies=1"
    exit 1
fi

echo -e "${GREEN}✓ mitmproxy running on port $MITMPROXY_PORT${NC}"
echo -e "${GREEN}✓ Using CA certificate: $MITMPROXY_CA${NC}"
echo -e "${GREEN}✓ Using proxychains config: $PROXYCHAINS_CONF${NC}"
echo ""

# Set NODE_EXTRA_CA_CERTS so Node.js trusts mitmproxy's certificate
export NODE_EXTRA_CA_CERTS="$MITMPROXY_CA"

# Also set NODE_TLS_REJECT_UNAUTHORIZED as a fallback (less secure but helps debug)
# Uncomment if you still have TLS issues:
# export NODE_TLS_REJECT_UNAUTHORIZED=0

echo -e "${CYAN}Running: cursor-agent $*${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""

# Run cursor-agent through proxychains
exec proxychains4 -f "$PROXYCHAINS_CONF" cursor-agent "$@"
