const { promisify } = require('util');
const { exec } = require('child_process');
const { escapeHtml } = require('../config/utils');

const execAsync = promisify(exec);

const WHITELIST = [
  'df -h',
  'free -m',
  'git status',
  'ls -alh',
  'pwd',
  'git pull origin main',
  'npm ci',
  'npm run check:syntax',
  'pm2 reload assistant-bot --update-env',
  'git pull origin main && npm ci && npm run check:syntax && pm2 reload assistant-bot --update-env',
  'pm2 list',
  'uname -a',
];

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

      if (!WHITELIST.includes(command)) {
        await ctx.replyWithHTML('🚫 Lệnh không nằm trong danh sách whitelist an toàn!');
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