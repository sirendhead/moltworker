#!/bin/bash
set -e
echo "=== OpenClaw MCP Server Setup ==="

# 1. Copy server to home
mkdir -p ~/openclaw-mcp
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/server.js" ~/openclaw-mcp/server.js
chmod +x ~/openclaw-mcp/server.js

# 2. Get gateway token from config
CONFIG_PATH="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "ERROR: Config not found at $CONFIG_PATH"
  echo "Make sure OpenClaw is installed and configured."
  exit 1
fi

TOKEN=$(node -e "
  const c = JSON.parse(require('fs').readFileSync('$CONFIG_PATH','utf8'));
  process.stdout.write(c.gateway?.auth?.token || '');
" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "WARNING: No gateway token found. Some tools may not work."
  echo "Set OPENCLAW_GATEWAY_TOKEN manually in the run script."
fi

# 3. Detect gateway port
PORT=$(node -e "
  const c = JSON.parse(require('fs').readFileSync('$CONFIG_PATH','utf8'));
  process.stdout.write(String(c.gateway?.port || 18789));
" 2>/dev/null || echo "18789")

# 4. Create wrapper script with token baked in
cat > ~/openclaw-mcp/run.sh << EOF
#!/bin/bash
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:${PORT}"
export OPENCLAW_GATEWAY_TOKEN="${TOKEN}"
export OPENCLAW_CONFIG="${CONFIG_PATH}"
exec node ~/openclaw-mcp/server.js
EOF
chmod +x ~/openclaw-mcp/run.sh

echo ""
echo "Done! MCP Server ready at: ~/openclaw-mcp/run.sh"
echo ""
echo "Gateway: http://127.0.0.1:${PORT}"
echo "Token: ${TOKEN:0:8}...${TOKEN: -4}"
echo ""
echo "Add to Claude Desktop (claude_desktop_config.json):"
echo ""
cat << CONF
{
  "mcpServers": {
    "openclaw": {
      "command": "$HOME/openclaw-mcp/run.sh"
    }
  }
}
CONF
echo ""
echo "Or for Claude Code (~/.mcp.json):"
echo ""
cat << CONF2
{
  "mcpServers": {
    "openclaw": {
      "command": "node",
      "args": ["$HOME/openclaw-mcp/server.js"],
      "env": {
        "OPENCLAW_GATEWAY_URL": "http://127.0.0.1:${PORT}",
        "OPENCLAW_GATEWAY_TOKEN": "${TOKEN}"
      }
    }
  }
}
CONF2
