#!/bin/bash
# Startup script for OpenClaw in Cloudflare Sandbox
# This script:
# 1. Restores config/workspace/skills from R2 via rclone (if configured)
# 2. Runs openclaw onboard --non-interactive to configure from env vars
# 3. Patches config for features onboard doesn't cover (channels, gateway auth)
# 4. Starts a background sync loop (rclone, watches for file changes)
# 5. Starts the gateway

set -e

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
WORKSPACE_DIR="/root/clawd"
SKILLS_DIR="/root/clawd/skills"

echo "Config directory: $CONFIG_DIR"

mkdir -p "$CONFIG_DIR"

# ============================================================
# R2 PERSISTENCE (handled by Worker, not rclone)
# ============================================================
# Config/workspace/skills are restored from R2 by the Worker's native R2 binding
# BEFORE this script runs (see src/gateway/r2-native.ts → restoreFromR2).
# Backup is handled by the cron handler (backupToR2) every 5 minutes.
# No rclone or S3 credentials needed.
echo "R2 persistence is managed by the Worker (native R2 binding)"

# ============================================================
# ONBOARD (only if no config exists yet)
# ============================================================
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, running openclaw onboard..."

    AUTH_ARGS=""
    if [ -n "$CLOUDFLARE_AI_GATEWAY_API_KEY" ] && [ -n "$CF_AI_GATEWAY_ACCOUNT_ID" ] && [ -n "$CF_AI_GATEWAY_GATEWAY_ID" ]; then
        AUTH_ARGS="--auth-choice cloudflare-ai-gateway-api-key \
            --cloudflare-ai-gateway-account-id $CF_AI_GATEWAY_ACCOUNT_ID \
            --cloudflare-ai-gateway-gateway-id $CF_AI_GATEWAY_GATEWAY_ID \
            --cloudflare-ai-gateway-api-key $CLOUDFLARE_AI_GATEWAY_API_KEY"
    elif [ -n "$ANTHROPIC_API_KEY" ]; then
        AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    elif [ -n "$OPENAI_API_KEY" ]; then
        AUTH_ARGS="--auth-choice openai-api-key --openai-api-key $OPENAI_API_KEY"
    fi

    openclaw onboard --non-interactive --accept-risk \
        --mode local \
        $AUTH_ARGS \
        --gateway-port 18789 \
        --gateway-bind lan \
        --skip-channels \
        --skip-skills \
        --skip-health

    echo "Onboard completed"
else
    echo "Using existing config"
fi

# ============================================================
# PATCH CONFIG (channels, gateway auth, trusted proxies)
# ============================================================
# openclaw onboard handles provider/model config, but we need to patch in:
# - Channel config (Telegram, Discord, Slack)
# - Gateway token auth
# - Trusted proxies for sandbox networking
# - Base URL override for legacy AI Gateway path
node << 'EOFPATCH'
const fs = require('fs');

const configPath = '/root/.openclaw/openclaw.json';
console.log('Patching config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

config.gateway = config.gateway || {};
config.channels = config.channels || {};

// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

// Enable HTTP API endpoints (for MCP server and external integrations)
config.gateway.http = config.gateway.http || {};
config.gateway.http.endpoints = config.gateway.http.endpoints || {};
config.gateway.http.endpoints.chatCompletions = { enabled: true };
config.gateway.http.endpoints.responses = { enabled: true };

if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
}

if (process.env.OPENCLAW_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Legacy AI Gateway base URL override:
// ANTHROPIC_BASE_URL is picked up natively by the Anthropic SDK,
// so we don't need to patch the provider config. Writing a provider
// entry without a models array breaks OpenClaw's config validation.

// AI Gateway model override (CF_AI_GATEWAY_MODEL=provider/model-id)
// Adds a provider entry for any AI Gateway provider and sets it as default model.
// Examples:
//   workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
//   openai/gpt-4o
//   anthropic/claude-sonnet-4-5
if (process.env.CF_AI_GATEWAY_MODEL) {
    const raw = process.env.CF_AI_GATEWAY_MODEL;
    const slashIdx = raw.indexOf('/');
    const gwProvider = raw.substring(0, slashIdx);
    const modelId = raw.substring(slashIdx + 1);

    const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
    const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
    const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;

    let baseUrl;
    if (accountId && gatewayId) {
        baseUrl = 'https://gateway.ai.cloudflare.com/v1/' + accountId + '/' + gatewayId + '/' + gwProvider;
        if (gwProvider === 'workers-ai') baseUrl += '/v1';
    } else if (gwProvider === 'workers-ai' && process.env.CF_ACCOUNT_ID) {
        baseUrl = 'https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/v1';
    }

    if (baseUrl && apiKey) {
        const api = gwProvider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
        const providerName = 'cf-ai-gw-' + gwProvider;

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers[providerName] = {
            baseUrl: baseUrl,
            apiKey: apiKey,
            api: api,
            models: [{ id: modelId, name: modelId, contextWindow: 131072, maxTokens: 8192 }],
        };
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: providerName + '/' + modelId };
        console.log('AI Gateway model override: provider=' + providerName + ' model=' + modelId + ' via ' + baseUrl);
    } else {
        console.warn('CF_AI_GATEWAY_MODEL set but missing required config (account ID, gateway ID, or API key)');
    }
}

// Telegram configuration
// Overwrite entire channel object to drop stale keys from old R2 backups
// that would fail OpenClaw's strict config validation (see #47)
if (process.env.TELEGRAM_BOT_TOKEN) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
    config.channels.telegram = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        enabled: true,
        dmPolicy: dmPolicy,
    };
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
        config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (dmPolicy === 'open') {
        config.channels.telegram.allowFrom = ['*'];
    }
}

// Discord configuration
// Discord uses a nested dm object: dm.policy, dm.allowFrom (per DiscordDmConfig)
if (process.env.DISCORD_BOT_TOKEN) {
    const dmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
    const dm = { policy: dmPolicy };
    if (dmPolicy === 'open') {
        dm.allowFrom = ['*'];
    }
    config.channels.discord = {
        token: process.env.DISCORD_BOT_TOKEN,
        enabled: true,
        dm: dm,
    };
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = {
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        enabled: true,
    };
}

// ── INTELLIGENCE CONFIG ──────────────────────────────────────
// Match Claude.ai quality: thinking, model params, context management
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};

// 1. Extended Thinking — adaptive lets the model decide when to think deep
config.agents.defaults.thinkingDefault = 'adaptive';

// 2. Model parameters — optimize for quality
config.agents.defaults.models = config.agents.defaults.models || {};
// Anthropic model tuning (applies to any anthropic/ model)
const anthropicModelId = Object.keys(config.models?.providers || {})
    .filter(p => p.startsWith('cf-ai-gw-anthropic'))
    .map(p => p + '/' + (config.models.providers[p].models?.[0]?.id || ''))
    .find(Boolean);
if (anthropicModelId) {
    config.agents.defaults.models[anthropicModelId] = {
        streaming: true,
        params: {
            cacheRetention: 'short',
            maxTokens: 16000,
        },
    };
    console.log('Model params configured for:', anthropicModelId);
}

// 3. Context pruning — keep conversation relevant, prune stale tool outputs
config.agents.defaults.contextPruning = {
    mode: 'cache-ttl',
    ttl: '1h',
    keepLastAssistants: 3,
};

// 4. Compaction — smart summarization when context gets long
config.agents.defaults.compaction = config.agents.defaults.compaction || {};
config.agents.defaults.compaction.mode = 'safeguard';
config.agents.defaults.compaction.memoryFlush = {
    enabled: true,
    forceFlushTranscriptBytes: '2mb',
};

// 5. Concurrency — allow parallel agent work
config.agents.defaults.maxConcurrent = 4;
config.agents.defaults.subagents = config.agents.defaults.subagents || {};
config.agents.defaults.subagents.maxConcurrent = 8;
config.agents.defaults.subagents.thinking = 'medium';

// 6. Timezone for Vietnamese users
config.agents.defaults.userTimezone = 'Asia/Ho_Chi_Minh';
config.agents.defaults.timeFormat = '24';

// Tool profile: "full" allows all tools (exec, browser, web_search, etc.)
config.tools = config.tools || {};
config.tools.profile = 'full';

// Session visibility: allow dashboard to read all sessions
config.tools.sessions = config.tools.sessions || {};
config.tools.sessions.visibility = 'all';

// Browser: enable with headless mode for container environment
// Set executablePath explicitly — xdg-settings default-browser detection won't work headless
config.browser = config.browser || {};
config.browser.enabled = true;
config.browser.headless = true;
config.browser.noSandbox = true;
config.browser.executablePath = '/usr/bin/google-chrome-stable';

// Ensure SEO Gap Analyzer agent exists
config.agents = config.agents || {};
config.agents.list = config.agents.list || [];
if (!config.agents.list.some(a => a.id === 'seo-gap-analyzer')) {
    config.agents.list.push({
        id: 'seo-gap-analyzer',
        name: 'SEO Gap Analyzer',
        workspace: '/root/clawd/agents/seo-gap-analyzer',
        identity: { emoji: '🔍' },
    });
    console.log('Added SEO Gap Analyzer agent');
}

// Bind SEO Gap Analyzer to Telegram channel (all Telegram DMs → SEO agent)
config.bindings = config.bindings || [];
if (!config.bindings.some(b => b.agentId === 'seo-gap-analyzer' && b.match?.channel === 'telegram')) {
    config.bindings.push({
        agentId: 'seo-gap-analyzer',
        comment: 'Route all Telegram messages to SEO Gap Analyzer',
        match: { channel: 'telegram' },
    });
    console.log('Bound SEO Gap Analyzer to Telegram channel');
}

// Web search: store Brave API key in config if env var is set
if (process.env.BRAVE_API_KEY) {
    config.tools = config.tools || {};
    config.tools.web = config.tools.web || {};
    config.tools.web.search = config.tools.web.search || {};
    config.tools.web.search.apiKey = process.env.BRAVE_API_KEY;
    console.log('Brave API key configured for web_search');
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration patched successfully');
EOFPATCH

# ============================================================
# BACKGROUND SYNC (handled by Worker cron, not rclone)
# ============================================================
# The Worker's cron handler calls backupToR2() every 5 minutes.
# No background sync loop needed in the container.

# ============================================================
# START GATEWAY
# ============================================================
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
fi
