const { promisify } = require('util');
const { exec } = require('child_process');
const { escapeHtml } = require('../config/utils');

const execAsync = promisify(exec);

// Allowed base commands and safe subcommands. We accept arguments but sanitize them
const ALLOWED_BASES = new Set(['ls', 'git', 'df', 'free', 'pwd', 'npm', 'pm2', 'uname']);
const ALLOWED_GIT_SUBCOMMANDS = new Set(['pull', 'status', 'fetch', 'checkout', 'rev-parse']);
const ALLOWED_NPM_SUBCOMMANDS = new Set(['ci', 'run']);
const ALLOWED_PM2_SUBCOMMANDS = new Set(['reload', 'list']);

// Allow chaining with && and || but only if every subcommand is safe
const ALLOW_CHAINING = true;
const CHAIN_SPLITTER = /\s*(?:&&|\|\|)\s*/;

function isSafeSingleCommand(command) {
  if (!command) return false;

  // Disallow a set of obviously dangerous characters
  const forbidden = /[;<>`$(){}]/;
  if (forbidden.test(command)) return false;

  const tokens = command.trim().split(/\s+/);
  const base = tokens[0];

  if (!ALLOWED_BASES.has(base)) return false;

  if (base === 'git') {
    const sub = tokens[1];
    if (!sub || !ALLOWED_GIT_SUBCOMMANDS.has(sub)) return false;
  }

  if (base === 'npm') {
    const sub = tokens[1];
    if (!sub || !ALLOWED_NPM_SUBCOMMANDS.has(sub)) return false;
  }

  if (base === 'pm2') {
    const sub = tokens[1];
    if (!sub || !ALLOWED_PM2_SUBCOMMANDS.has(sub)) return false;
  }

  // Token-level safety: allow alphanum and common symbols used in flags/paths
  const safeToken = /^[A-Za-z0-9._\-:\/=@]+$/;
  for (const t of tokens) {
    if (!safeToken.test(t)) return false;
  }

  return true;
}

function isSafeCommand(command) {
  if (!command) return false;

  // Reject other dangerous characters early
  const forbidden = /[;<>`$(){}]/;
  if (forbidden.test(command)) return false;

  // If chaining not allowed, also reject any & or |
  if (!ALLOW_CHAINING && /[&|]/.test(command)) return false;

  // If chaining allowed, ensure only valid operators appear (&& or ||)
  if (ALLOW_CHAINING) {
    // Remove all valid chain tokens and check leftover for stray & or |
    const tmp = command.replace(/&&/g, '').replace(/\|\|/g, '');
    if (/[&|]/.test(tmp)) return false;
  }

  const parts = ALLOW_CHAINING ? command.split(CHAIN_SPLITTER) : [command];
  if (parts.length === 0) return false;

  for (const p of parts) {
    const sub = p.trim();
    if (!isSafeSingleCommand(sub)) return false;
  }

  return true;
}

function extractShellCommand(ctx) {
  const text = ctx.message?.text || '';
  const firstSpaceIndex = text.indexOf(' ');

  if (firstSpaceIndex === -1) {
    return '';
  }

  return text.slice(firstSpaceIndex + 1).trim();
}

async function executeShellCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024,
      timeout: 30000,
      shell: '/bin/bash',
    });

    return {
      ok: true,
      stdout: stdout || '',
      stderr: stderr || '',
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || String(error),
      code: error.code,
    };
  }
}

function buildOutputBlock(command, result) {
  const parts = [];
  parts.push(`Lệnh: ${command}`);
  parts.push(`Trạng thái: ${result.ok ? 'Thành công' : 'Thất bại'}`);

  if (result.stdout) {
    parts.push('');
    parts.push('stdout:');
    parts.push(result.stdout.trimEnd());
  }

  if (result.stderr) {
    parts.push('');
    parts.push('stderr:');
    parts.push(result.stderr.trimEnd());
  }

  if (typeof result.code !== 'undefined') {
    parts.push('');
    parts.push(`exit code: ${result.code}`);
  }

  return parts.join('\n');
}

module.exports = {
  name: 'sh',
  description: 'Chạy lệnh shell theo whitelist an toàn',
  execute: async (ctx) => {
    try {
      const command = extractShellCommand(ctx);

      if (!command) {
        await ctx.replyWithHTML('⚠️ Cú pháp: <code>/sh &lt;lệnh&gt;</code>');
        return;
      }

      if (!isSafeCommand(command)) {
        await ctx.replyWithHTML('🚫 Lệnh không hợp lệ hoặc không nằm trong danh sách cho phép an toàn!');
        return;
      }

      const result = await executeShellCommand(command);
      const output = buildOutputBlock(command, result);

      await ctx.replyWithHTML(`<pre>${escapeHtml(output)}</pre>`);
    } catch (error) {
      console.error('[SH_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh shell lúc này.');
    }
  },
};