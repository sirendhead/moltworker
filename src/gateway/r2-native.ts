import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';

/**
 * R2-native sync — uses the Worker's R2 binding directly.
 * No S3 credentials or rclone needed.
 */

const CONFIG_DIR = '/root/.openclaw';
const WORKSPACE_DIR = '/root/clawd';
const R2_PREFIX = 'openclaw/';

/**
 * Restore config and sessions from R2 to container.
 * Called before starting the gateway process.
 */
export async function restoreFromR2(
  sandbox: Sandbox,
  bucket: R2Bucket,
): Promise<{ restored: number; errors: string[] }> {
  const errors: string[] = [];
  let restored = 0;

  try {
    const listed = await bucket.list({ prefix: R2_PREFIX });

    if (!listed.objects.length) {
      console.log('[R2] No backup found in R2');
      return { restored: 0, errors: [] };
    }

    console.log(`[R2] Restoring ${listed.objects.length} files from R2...`);

    for (const obj of listed.objects) {
      // Convert R2 key to container path
      // "openclaw/openclaw.json" → "/root/.openclaw/openclaw.json"
      // "openclaw/agents/seo-gap-analyzer/sessions/..." → "/root/.openclaw/agents/..."
      const relativePath = obj.key.slice(R2_PREFIX.length);
      if (!relativePath) continue;

      const containerPath = `${CONFIG_DIR}/${relativePath}`;

      try {
        const body = await bucket.get(obj.key);
        if (!body) continue;

        const content = await body.text();

        // Ensure parent directory exists
        const dir = containerPath.substring(0, containerPath.lastIndexOf('/'));
        await sandbox.exec(`mkdir -p "${dir}"`);

        // Write file
        await sandbox.writeFile(containerPath, content);
        restored++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${obj.key}: ${msg}`);
      }
    }

    console.log(`[R2] Restored ${restored} files (${errors.length} errors)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`list failed: ${msg}`);
    console.error('[R2] Restore failed:', msg);
  }

  return { restored, errors };
}

/**
 * Backup config and sessions from container to R2.
 * Called by the cron handler.
 */
export async function backupToR2(
  sandbox: Sandbox,
  bucket: R2Bucket,
): Promise<{ backed: number; errors: string[] }> {
  const errors: string[] = [];
  let backed = 0;

  try {
    // 1. Backup openclaw.json (most critical)
    const configResult = await sandbox.exec(`cat ${CONFIG_DIR}/openclaw.json 2>/dev/null`);
    if (configResult.stdout) {
      await bucket.put(`${R2_PREFIX}openclaw.json`, configResult.stdout);
      backed++;
    }

    // 2. Find and backup session files for all agents
    const findResult = await sandbox.exec(
      `find ${CONFIG_DIR}/agents -name "sessions.json" -o -name "*.jsonl" 2>/dev/null | head -100`,
    );

    if (findResult.stdout) {
      const files = findResult.stdout.trim().split('\n').filter(Boolean);

      for (const filePath of files) {
        try {
          // Read file content
          const fileResult = await sandbox.exec(`cat "${filePath}" 2>/dev/null`);
          if (!fileResult.stdout) continue;

          // Convert path to R2 key
          // "/root/.openclaw/agents/seo-gap-analyzer/sessions/sessions.json"
          // → "openclaw/agents/seo-gap-analyzer/sessions/sessions.json"
          const relativePath = filePath.replace(CONFIG_DIR + '/', '');
          await bucket.put(`${R2_PREFIX}${relativePath}`, fileResult.stdout);
          backed++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${filePath}: ${msg}`);
        }
      }
    }

    // 3. Backup workspace agent files (soul.md, tools.md, MEMORY.md)
    const agentFilesResult = await sandbox.exec(
      `find ${WORKSPACE_DIR}/agents -maxdepth 2 \\( -name "soul.md" -o -name "tools.md" -o -name "MEMORY.md" \\) 2>/dev/null`,
    );

    if (agentFilesResult.stdout) {
      const agentFiles = agentFilesResult.stdout.trim().split('\n').filter(Boolean);
      for (const filePath of agentFiles) {
        try {
          const fileResult = await sandbox.exec(`cat "${filePath}" 2>/dev/null`);
          if (!fileResult.stdout) continue;

          const relativePath = filePath.replace(WORKSPACE_DIR + '/', '');
          await bucket.put(`workspace/${relativePath}`, fileResult.stdout);
          backed++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${filePath}: ${msg}`);
        }
      }
    }

    console.log(`[R2] Backed up ${backed} files (${errors.length} errors)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`backup failed: ${msg}`);
    console.error('[R2] Backup failed:', msg);
  }

  return { backed, errors };
}
