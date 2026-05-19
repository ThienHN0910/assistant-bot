const { promisify } = require('util');
const { exec } = require('child_process');
const { escapeHtml } = require('../config/utils');

const execAsync = promisify(exec);

async function runCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024,
      timeout: 30000,
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

function formatResult(command, result) {
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
  name: 'npmcache',
  description: 'Dọn cache npm',
  execute: async (ctx) => {
    try {
      const command = 'npm cache clean --force';
      const result = await runCommand(command);

      await ctx.replyWithHTML(
        `<b>🧽 Kết quả dọn cache npm</b>\n<pre>${escapeHtml(formatResult(command, result))}</pre>`,
      );
    } catch (error) {
      console.error('[NPMCACHE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể dọn cache npm lúc này.');
    }
  },
};