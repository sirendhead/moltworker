import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import {
  ensureMoltbotGateway,
  findExistingMoltbotProcess,
  syncToR2,
  waitForProcess,
} from '../gateway';

// CLI commands can take 10-15 seconds to complete due to WebSocket connection overhead
const CLI_TIMEOUT_MS = 20000;

/**
 * API routes
 * - /api/admin/* - Protected admin API routes (Cloudflare Access required)
 *
 * Note: /api/status is now handled by publicRoutes (no auth required)
 */
const api = new Hono<AppEnv>();

/**
 * Admin API routes - all protected by Cloudflare Access
 */
const adminApi = new Hono<AppEnv>();

// Middleware: Verify Cloudflare Access JWT for all admin routes
adminApi.use('*', createAccessMiddleware({ type: 'json' }));

// GET /api/admin/devices - List pending and paired devices
adminApi.get('/devices', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run OpenClaw CLI to list devices
    // Must specify --url and --token (OpenClaw v2026.2.3 requires explicit credentials with --url)
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const proc = await sandbox.startProcess(
      `openclaw devices list --json --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Try to parse JSON output
    try {
      // Find JSON in output (may have other log lines)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return c.json(data);
      }

      // If no JSON found, return raw output for debugging
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
      });
    } catch {
      return c.json({
        pending: [],
        paired: [],
        raw: stdout,
        stderr,
        parseError: 'Failed to parse CLI output',
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/:requestId/approve - Approve a pending device
adminApi.post('/devices/:requestId/approve', async (c) => {
  const sandbox = c.get('sandbox');
  const requestId = c.req.param('requestId');

  if (!requestId) {
    return c.json({ error: 'requestId is required' }, 400);
  }

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // Run OpenClaw CLI to approve the device
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const proc = await sandbox.startProcess(
      `openclaw devices approve ${requestId} --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(proc, CLI_TIMEOUT_MS);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Check for success indicators (case-insensitive, CLI outputs "Approved ...")
    const success = stdout.toLowerCase().includes('approved') || proc.exitCode === 0;

    return c.json({
      success,
      requestId,
      message: success ? 'Device approved' : 'Approval may have failed',
      stdout,
      stderr,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// POST /api/admin/devices/approve-all - Approve all pending devices
adminApi.post('/devices/approve-all', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Ensure moltbot is running first
    await ensureMoltbotGateway(sandbox, c.env);

    // First, get the list of pending devices
    const token = c.env.MOLTBOT_GATEWAY_TOKEN;
    const tokenArg = token ? ` --token ${token}` : '';
    const listProc = await sandbox.startProcess(
      `openclaw devices list --json --url ws://localhost:18789${tokenArg}`,
    );
    await waitForProcess(listProc, CLI_TIMEOUT_MS);

    const listLogs = await listProc.getLogs();
    const stdout = listLogs.stdout || '';

    // Parse pending devices
    let pending: Array<{ requestId: string }> = [];
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        pending = data.pending || [];
      }
    } catch {
      return c.json({ error: 'Failed to parse device list', raw: stdout }, 500);
    }

    if (pending.length === 0) {
      return c.json({ approved: [], message: 'No pending devices to approve' });
    }

    // Approve each pending device
    const results: Array<{ requestId: string; success: boolean; error?: string }> = [];

    for (const device of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential device approval required
        const approveProc = await sandbox.startProcess(
          `openclaw devices approve ${device.requestId} --url ws://localhost:18789${tokenArg}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await waitForProcess(approveProc, CLI_TIMEOUT_MS);

        // eslint-disable-next-line no-await-in-loop
        const approveLogs = await approveProc.getLogs();
        const success =
          approveLogs.stdout?.toLowerCase().includes('approved') || approveProc.exitCode === 0;

        results.push({ requestId: device.requestId, success });
      } catch (err) {
        results.push({
          requestId: device.requestId,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const approvedCount = results.filter((r) => r.success).length;
    return c.json({
      approved: results.filter((r) => r.success).map((r) => r.requestId),
      failed: results.filter((r) => !r.success),
      message: `Approved ${approvedCount} of ${pending.length} device(s)`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// GET /api/admin/storage - Get R2 storage status and last sync time
adminApi.get('/storage', async (c) => {
  const sandbox = c.get('sandbox');
  const hasCredentials = !!(
    c.env.R2_ACCESS_KEY_ID &&
    c.env.R2_SECRET_ACCESS_KEY &&
    c.env.CF_ACCOUNT_ID
  );

  const missing: string[] = [];
  if (!c.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!c.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!c.env.CF_ACCOUNT_ID) missing.push('CF_ACCOUNT_ID');

  let lastSync: string | null = null;

  if (hasCredentials) {
    try {
      const result = await sandbox.exec('cat /tmp/.last-sync 2>/dev/null || echo ""');
      const timestamp = result.stdout?.trim();
      if (timestamp && timestamp !== '') {
        lastSync = timestamp;
      }
    } catch {
      // Ignore errors checking sync status
    }
  }

  return c.json({
    configured: hasCredentials,
    missing: missing.length > 0 ? missing : undefined,
    lastSync,
    message: hasCredentials
      ? 'R2 storage is configured. Your data will persist across container restarts.'
      : 'R2 storage is not configured. Paired devices and conversations will be lost when the container restarts.',
  });
});

// POST /api/admin/storage/sync - Trigger a manual sync to R2
adminApi.post('/storage/sync', async (c) => {
  const sandbox = c.get('sandbox');

  const result = await syncToR2(sandbox, c.env);

  if (result.success) {
    return c.json({
      success: true,
      message: 'Sync completed successfully',
      lastSync: result.lastSync,
    });
  } else {
    const status = result.error?.includes('not configured') ? 400 : 500;
    return c.json(
      {
        success: false,
        error: result.error,
        details: result.details,
      },
      status,
    );
  }
});

// POST /api/admin/gateway/restart - Kill the current gateway and start a new one
adminApi.post('/gateway/restart', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    // Find and kill the existing gateway process
    const existingProcess = await findExistingMoltbotProcess(sandbox);

    if (existingProcess) {
      console.log('Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('Error killing process:', killErr);
      }
      // Wait a moment for the process to die
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Start a new gateway in the background
    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('Gateway restart failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      success: true,
      message: existingProcess
        ? 'Gateway process killed, new instance starting...'
        : 'No existing process found, starting new instance...',
      previousProcessId: existingProcess?.id,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});

// =============================================================================
// Skills Management API
// =============================================================================

// GET /api/admin/skills - List installed skills and their status
adminApi.get('/skills', async (c) => {
  const sandbox = c.get('sandbox');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    // List skill files from workspace and managed dirs
    // Skills are stored as either <dir>/<skill-name>/SKILL.md or <dir>/<skill-name>.md
    const result = await sandbox.exec(
      'find /root/clawd/skills /root/.openclaw/skills -name "*.md" -type f 2>/dev/null | head -100',
    );
    const files = (result.stdout || '').trim().split('\n').filter(Boolean);

    // Read openclaw config for skill settings
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let skillEntries: Record<string, { enabled?: boolean; apiKey?: string }> = {};
    try {
      const config = JSON.parse(configResult.stdout || '{}');
      skillEntries = config?.skills?.entries || {};
    } catch {
      // ignore parse errors
    }

    const skills = [];
    for (const filePath of files) {
      const parts = filePath.split('/');
      const fileName = parts[parts.length - 1] || '';
      // If file is SKILL.md, use parent dir name; otherwise use filename without .md
      const name = fileName === 'SKILL.md'
        ? (parts[parts.length - 2] || 'unknown')
        : fileName.replace('.md', '');
      const dir = filePath.includes('/root/clawd/skills') ? 'workspace' : 'managed';
      const config = skillEntries[name];
      skills.push({
        name,
        filePath,
        source: dir,
        enabled: config?.enabled !== false,
        hasApiKey: !!config?.apiKey,
      });
    }

    return c.json({ ok: true, skills });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// GET /api/admin/skills/:name - Get skill content
adminApi.get('/skills/:name', async (c) => {
  const sandbox = c.get('sandbox');
  const name = c.req.param('name');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    // Try workspace first, then managed; check both <name>/SKILL.md and <name>.md
    let content = '';
    let filePath = '';
    for (const dir of ['/root/clawd/skills', '/root/.openclaw/skills']) {
      for (const candidate of [`${dir}/${name}/SKILL.md`, `${dir}/${name}.md`]) {
        const result = await sandbox.exec(`cat "${candidate}" 2>/dev/null`);
        if (result.stdout) {
          content = result.stdout;
          filePath = candidate;
          break;
        }
      }
      if (content) break;
    }

    if (!content) {
      return c.json({ ok: false, error: `Skill not found: ${name}` }, 404);
    }

    return c.json({ ok: true, name, filePath, content });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// PUT /api/admin/skills/:name - Create or update a skill
adminApi.put('/skills/:name', async (c) => {
  const sandbox = c.get('sandbox');
  const name = c.req.param('name');

  try {
    const body = await c.req.json<{ content: string; dir?: string }>();
    if (!body.content) {
      return c.json({ ok: false, error: 'content is required' }, 400);
    }

    // Validate skill name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return c.json({ ok: false, error: 'Invalid skill name. Use alphanumeric, hyphens, underscores only.' }, 400);
    }

    await ensureMoltbotGateway(sandbox, c.env);

    const targetDir = body.dir === 'managed' ? '/root/.openclaw/skills' : '/root/clawd/skills';
    const skillDir = `${targetDir}/${name}`;
    await sandbox.exec(`mkdir -p "${skillDir}"`);

    const filePath = `${skillDir}/SKILL.md`;
    await sandbox.writeFile(filePath, body.content);

    return c.json({ ok: true, name, filePath, message: `Skill ${name} saved` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// DELETE /api/admin/skills/:name - Delete a skill
adminApi.delete('/skills/:name', async (c) => {
  const sandbox = c.get('sandbox');
  const name = c.req.param('name');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    // Try to delete from both dirs; check both <name>/SKILL.md and <name>.md
    let deleted = false;
    for (const dir of ['/root/clawd/skills', '/root/.openclaw/skills']) {
      // Check for directory-based skill first
      const dirCheck = await sandbox.exec(`test -d "${dir}/${name}" && echo yes || echo no`);
      if (dirCheck.stdout?.trim() === 'yes') {
        await sandbox.exec(`rm -rf "${dir}/${name}"`);
        deleted = true;
        continue;
      }
      // Check for flat file
      const fileCheck = await sandbox.exec(`test -f "${dir}/${name}.md" && echo yes || echo no`);
      if (fileCheck.stdout?.trim() === 'yes') {
        await sandbox.exec(`rm "${dir}/${name}.md"`);
        deleted = true;
      }
    }

    if (!deleted) {
      return c.json({ ok: false, error: `Skill not found: ${name}` }, 404);
    }

    return c.json({ ok: true, name, message: `Skill ${name} deleted` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// PATCH /api/admin/skills/:name/config - Update skill config (enable/disable, API key, env)
adminApi.patch('/skills/:name/config', async (c) => {
  const sandbox = c.get('sandbox');
  const name = c.req.param('name');

  try {
    const body = await c.req.json<{ enabled?: boolean; apiKey?: string; env?: Record<string, string> }>();

    await ensureMoltbotGateway(sandbox, c.env);

    // Read current config
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    const config = JSON.parse(configResult.stdout || '{}');

    // Update skill entry
    config.skills = config.skills || {};
    config.skills.entries = config.skills.entries || {};
    const entry = config.skills.entries[name] || {};

    if (typeof body.enabled === 'boolean') entry.enabled = body.enabled;
    if (typeof body.apiKey === 'string') {
      if (body.apiKey.trim()) entry.apiKey = body.apiKey.trim();
      else delete entry.apiKey;
    }
    if (body.env && typeof body.env === 'object') {
      entry.env = entry.env || {};
      for (const [key, value] of Object.entries(body.env)) {
        if (value.trim()) entry.env[key] = value.trim();
        else delete entry.env[key];
      }
    }

    config.skills.entries[name] = entry;

    await sandbox.writeFile('/root/.openclaw/openclaw.json', JSON.stringify(config, null, 2));

    return c.json({ ok: true, name, config: entry, message: `Skill ${name} config updated` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// =============================================================================
// Gateway Config API
// =============================================================================

// GET /api/admin/config - Read openclaw.json
adminApi.get('/config', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureMoltbotGateway(sandbox, c.env);
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }
    return c.json({ ok: true, config });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// PATCH /api/admin/config - Merge-update openclaw.json (shallow merge at top-level keys)
adminApi.patch('/config', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureMoltbotGateway(sandbox, c.env);
    const body = await c.req.json();

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    // Deep merge for known nested keys, shallow for the rest
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof config[key] === 'object') {
        config[key] = { ...config[key], ...value };
      } else {
        config[key] = value;
      }
    }

    const configJson = JSON.stringify(config, null, 2);
    await sandbox.exec(`cat > /root/.openclaw/openclaw.json << 'CONFIGEOF'\n${configJson}\nCONFIGEOF`);

    return c.json({ ok: true, config });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// =============================================================================
// Agents Management API
// =============================================================================

// GET /api/admin/agents - List configured agents
adminApi.get('/agents', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    const agentsList = config?.agents?.list || [];
    const defaultId = config?.agents?.defaultId || 'main';

    const agents = agentsList.map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      workspace: entry.workspace,
      model: typeof entry.model === 'string' ? entry.model : entry.model?.primary,
      identity: entry.identity,
      isDefault: entry.id === defaultId,
    }));

    // If no agents configured, return at least the default
    if (agents.length === 0) {
      agents.push({ id: defaultId, name: 'Main', isDefault: true });
    }

    return c.json({ ok: true, agents, defaultId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// POST /api/admin/agents - Create a new agent
adminApi.post('/agents', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const body = await c.req.json<{ name: string; workspace?: string; emoji?: string; model?: string }>();
    if (!body.name?.trim()) {
      return c.json({ ok: false, error: 'name is required' }, 400);
    }

    // Normalize ID from name
    const agentId = body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!agentId) {
      return c.json({ ok: false, error: 'invalid agent name' }, 400);
    }

    // Read current config
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    // Check if agent already exists
    const list = config?.agents?.list || [];
    if (list.some((e: any) => e.id === agentId)) {
      return c.json({ ok: false, error: `agent '${agentId}' already exists` }, 409);
    }

    // Build agent entry
    const workspace = body.workspace || `/root/clawd/agents/${agentId}`;
    const entry: any = { id: agentId, name: body.name.trim(), workspace };
    if (body.model) entry.model = body.model;
    if (body.emoji) entry.identity = { emoji: body.emoji };

    // Add to config
    if (!config.agents) config.agents = {};
    if (!config.agents.list) config.agents.list = [];
    config.agents.list.push(entry);

    // Write config
    const configJson = JSON.stringify(config, null, 2);
    await sandbox.exec(`cat > /root/.openclaw/openclaw.json << 'CONFIGEOF'\n${configJson}\nCONFIGEOF`);

    // Create workspace directory with bootstrap files
    await sandbox.exec(`mkdir -p "${workspace}"`);
    await sandbox.exec(`echo "# ${body.name.trim()}" > "${workspace}/MEMORY.md"`);

    return c.json({ ok: true, agentId, name: body.name.trim(), workspace });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// PATCH /api/admin/agents/:id - Update an agent
adminApi.patch('/agents/:id', async (c) => {
  const sandbox = c.get('sandbox');
  const agentId = c.req.param('id');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const body = await c.req.json<{ name?: string; workspace?: string; model?: string; avatar?: string }>();

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    if (!config.agents) config.agents = {};
    if (!config.agents.list) config.agents.list = [];
    const list = config.agents.list;
    let index = list.findIndex((e: any) => e.id === agentId);

    // Auto-create implicit default agent entry if not in list
    const defaultId = config.agents.defaultId || 'main';
    if (index < 0 && agentId === defaultId) {
      list.push({ id: agentId, name: 'Main', workspace: `/root/clawd/agents/${agentId}` });
      index = list.length - 1;
    }
    if (index < 0) {
      return c.json({ ok: false, error: `agent '${agentId}' not found` }, 404);
    }

    // Apply updates
    if (body.name) list[index].name = body.name;
    if (body.workspace) list[index].workspace = body.workspace;
    if (body.model) list[index].model = body.model;
    if (body.avatar) {
      list[index].identity = { ...(list[index].identity || {}), avatar: body.avatar };
    }

    config.agents.list = list;
    const configJson = JSON.stringify(config, null, 2);
    await sandbox.exec(`cat > /root/.openclaw/openclaw.json << 'CONFIGEOF'\n${configJson}\nCONFIGEOF`);

    return c.json({ ok: true, agentId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// DELETE /api/admin/agents/:id - Delete an agent
adminApi.delete('/agents/:id', async (c) => {
  const sandbox = c.get('sandbox');
  const agentId = c.req.param('id');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const deleteFiles = c.req.query('deleteFiles') !== 'false';

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    const list = config?.agents?.list || [];
    const index = list.findIndex((e: any) => e.id === agentId);
    if (index < 0) {
      return c.json({ ok: false, error: `agent '${agentId}' not found` }, 404);
    }

    const workspace = list[index].workspace;

    // Remove from list
    list.splice(index, 1);
    config.agents.list = list.length > 0 ? list : undefined;

    // Remove agent from bindings
    let removedBindings = 0;
    if (Array.isArray(config.bindings)) {
      const before = config.bindings.length;
      config.bindings = config.bindings.filter((b: any) => b.agentId !== agentId);
      removedBindings = before - config.bindings.length;
      if (config.bindings.length === 0) delete config.bindings;
    }

    const configJson = JSON.stringify(config, null, 2);
    await sandbox.exec(`cat > /root/.openclaw/openclaw.json << 'CONFIGEOF'\n${configJson}\nCONFIGEOF`);

    // Delete workspace files if requested
    if (deleteFiles && workspace) {
      await sandbox.exec(`rm -rf "${workspace}" 2>/dev/null || true`);
    }

    return c.json({ ok: true, agentId, removedBindings });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// GET /api/admin/agents/:id/files - List agent workspace files
adminApi.get('/agents/:id/files', async (c) => {
  const sandbox = c.get('sandbox');
  const agentId = c.req.param('id');

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    const list = config?.agents?.list || [];
    const entry = list.find((e: any) => e.id === agentId);
    const workspace = entry?.workspace || `/root/clawd/agents/${agentId}`;

    const result = await sandbox.exec(`find "${workspace}" -maxdepth 1 -name "*.md" -type f 2>/dev/null | head -20`);
    const files = (result.stdout || '').trim().split('\n').filter(Boolean).map((path: string) => {
      const name = path.split('/').pop() || path;
      return { name, path };
    });

    return c.json({ ok: true, agentId, workspace, files });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// GET /api/admin/agents/:id/files/:name - Read agent file
adminApi.get('/agents/:id/files/:name', async (c) => {
  const sandbox = c.get('sandbox');
  const agentId = c.req.param('id');
  const fileName = c.req.param('name');

  // Only allow .md files
  if (!fileName.endsWith('.md')) {
    return c.json({ ok: false, error: 'only .md files allowed' }, 400);
  }

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    const list = config?.agents?.list || [];
    const entry = list.find((e: any) => e.id === agentId);
    const workspace = entry?.workspace || `/root/clawd/agents/${agentId}`;
    const filePath = `${workspace}/${fileName}`;

    const result = await sandbox.exec(`cat "${filePath}" 2>/dev/null`);
    if (result.exitCode !== 0) {
      return c.json({ ok: true, agentId, file: { name: fileName, path: filePath, missing: true } });
    }

    return c.json({ ok: true, agentId, file: { name: fileName, path: filePath, missing: false, content: result.stdout } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// PUT /api/admin/agents/:id/files/:name - Write agent file
adminApi.put('/agents/:id/files/:name', async (c) => {
  const sandbox = c.get('sandbox');
  const agentId = c.req.param('id');
  const fileName = c.req.param('name');

  if (!fileName.endsWith('.md')) {
    return c.json({ ok: false, error: 'only .md files allowed' }, 400);
  }

  try {
    await ensureMoltbotGateway(sandbox, c.env);

    const body = await c.req.json<{ content: string }>();
    if (typeof body.content !== 'string') {
      return c.json({ ok: false, error: 'content is required' }, 400);
    }

    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    let config: any = {};
    try { config = JSON.parse(configResult.stdout || '{}'); } catch { /* empty */ }

    const list = config?.agents?.list || [];
    const entry = list.find((e: any) => e.id === agentId);
    const workspace = entry?.workspace || `/root/clawd/agents/${agentId}`;
    const filePath = `${workspace}/${fileName}`;

    await sandbox.exec(`mkdir -p "${workspace}"`);
    // Use base64 to safely write content with special characters
    const b64 = Buffer.from(body.content).toString('base64');
    await sandbox.exec(`echo "${b64}" | base64 -d > "${filePath}"`);

    return c.json({ ok: true, agentId, file: { name: fileName, path: filePath, size: body.content.length } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ ok: false, error: errorMessage }, 500);
  }
});

// Mount admin API routes under /admin
api.route('/admin', adminApi);

export { api };
