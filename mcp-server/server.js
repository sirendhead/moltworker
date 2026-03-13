#!/usr/bin/env node
/**
 * OpenClaw MCP Server — Local Mode
 *
 * Runs on the same machine as OpenClaw gateway.
 * Shell via child_process, config via direct fs, API via localhost HTTP.
 *
 * Env vars:
 *   OPENCLAW_GATEWAY_URL   - Gateway URL (default: http://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_TOKEN - Gateway auth token
 *   OPENCLAW_CONFIG        - Path to openclaw.json (default: ~/.openclaw/openclaw.json)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG ||
  path.join(process.env.HOME || "/root", ".openclaw", "openclaw.json");

// ============================================================
// Shell — direct child_process (no gateway dependency)
// ============================================================

function shellExec(cmd, timeout = 30000) {
  try {
    const stdout = execSync(cmd, {
      timeout,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, exitCode: 0, stdout: stdout || "", stderr: "" };
  } catch (e) {
    return {
      ok: true,
      exitCode: e.status ?? 1,
      stdout: e.stdout || "",
      stderr: e.stderr || "",
    };
  }
}

// ============================================================
// Config — direct filesystem (no API needed)
// ============================================================

function configRead() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function configPatch(dotPath, value) {
  const config = configRead();
  const keys = dotPath.split(".");
  let target = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in target) || typeof target[keys[i]] !== "object") {
      target[keys[i]] = {};
    }
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { ok: true, patched: dotPath, value };
}

function configDelete(dotPath) {
  const config = configRead();
  const keys = dotPath.split(".");
  let target = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in target)) return { ok: true, message: "path not found" };
    target = target[keys[i]];
  }
  delete target[keys[keys.length - 1]];
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { ok: true, deleted: dotPath };
}

// ============================================================
// Gateway HTTP API
// ============================================================

async function api(method, apiPath, body) {
  const headers = { "Content-Type": "application/json" };
  if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;

  const res = await fetch(`${GATEWAY_URL}${apiPath}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// ============================================================
// Tool definitions
// ============================================================

const TOOLS = [
  {
    name: "shell",
    description:
      "Run any shell command on the OpenClaw server. Returns stdout, stderr, and exit code.",
    inputSchema: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Shell command to execute" },
        timeout: {
          type: "number",
          description: "Timeout in ms (default: 30000)",
        },
      },
      required: ["cmd"],
    },
  },
  {
    name: "config_read",
    description:
      "Read the full openclaw.json config, or a specific dot-path (e.g. 'channels.telegram').",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional dot-path to read specific field (e.g. 'gateway.auth.token')",
        },
      },
    },
  },
  {
    name: "config_patch",
    description:
      "Set a value in openclaw.json by dot-path. Example: path='channels.telegram.dmPolicy', value='open'",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Dot-path (e.g. channels.telegram.botToken)",
        },
        value: { description: "New value (string, number, boolean, or object)" },
      },
      required: ["path", "value"],
    },
  },
  {
    name: "config_delete",
    description: "Delete a key from openclaw.json by dot-path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Dot-path to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "gateway_restart",
    description: "Restart the OpenClaw gateway process.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "gateway_status",
    description:
      "Check gateway health: running/stopped, uptime, connected channels.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "logs",
    description: "Read recent gateway logs.",
    inputSchema: {
      type: "object",
      properties: {
        n: {
          type: "number",
          description: "Number of lines (default: 50)",
        },
      },
    },
  },
  {
    name: "agent_file_read",
    description:
      "Read a file from agent workspace (soul.md, identity.md, tools.md, MEMORY.md, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent ID (default: main)",
          default: "main",
        },
        file: { type: "string", description: "File name (e.g. soul.md)" },
      },
      required: ["file"],
    },
  },
  {
    name: "agent_file_write",
    description:
      "Write a file to agent workspace (soul.md, identity.md, tools.md, MEMORY.md, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent ID (default: main)",
          default: "main",
        },
        file: { type: "string", description: "File name (e.g. soul.md)" },
        content: { type: "string", description: "File content" },
      },
      required: ["file", "content"],
    },
  },
  {
    name: "skills_list",
    description: "List all installed skills and their enabled/disabled status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "chat",
    description:
      "Send a message to OpenClaw agent and get a response. Uses chat completions API.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to send" },
        agent: { type: "string", description: "Agent ID (default: main)" },
        session: { type: "string", description: "Session key for continuity" },
      },
      required: ["message"],
    },
  },
];

// ============================================================
// Tool handlers
// ============================================================

async function handle(name, args) {
  switch (name) {
    case "shell":
      return shellExec(args.cmd, args.timeout || 30000);

    case "config_read": {
      const config = configRead();
      if (!args.path) return config;
      const keys = args.path.split(".");
      let val = config;
      for (const k of keys) {
        if (val == null || typeof val !== "object") return { value: undefined };
        val = val[k];
      }
      return { path: args.path, value: val };
    }

    case "config_patch":
      return configPatch(args.path, args.value);

    case "config_delete":
      return configDelete(args.path);

    case "gateway_restart": {
      // Try CLI first, fall back to pkill + restart
      const r = shellExec(
        'openclaw gateway restart 2>&1 || (pkill -f "openclaw gateway" 2>/dev/null; sleep 2; nohup openclaw gateway --port 18789 --bind lan > /tmp/openclaw-restart.log 2>&1 & sleep 3; echo "RESTARTED")',
        15000,
      );
      return r;
    }

    case "gateway_status": {
      try {
        const health = await api("GET", "/health");
        const ps = shellExec("pgrep -la openclaw 2>/dev/null || echo 'no process'");
        return { gateway: health, processes: ps.stdout.trim() };
      } catch (e) {
        return { status: "unreachable", error: e.message };
      }
    }

    case "logs": {
      const n = args.n || 50;
      // Try log file first, fall back to journalctl
      const r = shellExec(
        `cat /tmp/openclaw/openclaw-*.log 2>/dev/null | tail -${n} || journalctl -u openclaw --no-pager -n ${n} 2>/dev/null || echo "no logs found"`,
      );
      return r;
    }

    case "agent_file_read": {
      const agent = args.agent || "main";
      const workspace =
        agent === "main"
          ? "/root/.openclaw/workspace"
          : `/root/clawd/agents/${agent}`;
      const filePath = path.join(workspace, args.file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        return { ok: true, file: args.file, content };
      } catch {
        return { ok: false, file: args.file, error: "file not found" };
      }
    }

    case "agent_file_write": {
      const agent = args.agent || "main";
      const workspace =
        agent === "main"
          ? "/root/.openclaw/workspace"
          : `/root/clawd/agents/${agent}`;
      const filePath = path.join(workspace, args.file);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, args.content);
      return {
        ok: true,
        file: args.file,
        size: Buffer.byteLength(args.content),
      };
    }

    case "skills_list": {
      const r = shellExec(
        'find /root/clawd/skills /root/.openclaw/skills -name "*.md" -type f 2>/dev/null',
      );
      const files = r.stdout.trim().split("\n").filter(Boolean);
      const skills = files.map((f) => {
        const parts = f.split("/");
        const fileName = parts[parts.length - 1];
        const name =
          fileName === "SKILL.md"
            ? parts[parts.length - 2]
            : fileName.replace(".md", "");
        return { name, path: f };
      });
      return { ok: true, skills };
    }

    case "chat": {
      const messages = [{ role: "user", content: args.message }];
      const headers = {};
      if (args.agent) headers["x-openclaw-agent-id"] = args.agent;
      if (args.session) headers["x-openclaw-session-key"] = args.session;

      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GATEWAY_TOKEN}`,
          ...headers,
        },
        body: JSON.stringify({
          model: "openclaw:main",
          messages,
          stream: false,
        }),
      });
      const data = await res.json();
      return {
        response: data.choices?.[0]?.message?.content || "(no response)",
        usage: data.usage,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================================
// MCP JSON-RPC transport (stdio)
// ============================================================

function send(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function sendErr(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line.trim());
  } catch {
    return;
  }
  const { id, method, params } = req;

  try {
    switch (method) {
      case "initialize":
        send(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "openclaw-local", version: "2.0.0" },
        });
        break;

      case "notifications/initialized":
        // no-op, no response needed
        break;

      case "tools/list":
        send(id, { tools: TOOLS });
        break;

      case "tools/call": {
        const result = await handle(params.name, params.arguments || {});
        const text =
          typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2);
        send(id, { content: [{ type: "text", text }] });
        break;
      }

      default:
        if (id != null) sendErr(id, -32601, `Method not found: ${method}`);
        break;
    }
  } catch (e) {
    if (id != null) sendErr(id, -32603, e.message);
  }
});

// Suppress unhandled rejection crashes
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[openclaw-mcp] unhandled rejection: ${err}\n`);
});
