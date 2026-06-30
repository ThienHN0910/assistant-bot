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
  name: 'stop',
  description: 'Dừng process PM2 của bot',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /stop</b>\n` +
          `Dừng tiến trình PM2 của bot từ xa.\n\n` +
          `<b>Cú pháp:</b> <code>/stop</code>\n` +
          `<b>Ví dụ:</b> <code>/stop</code>`
        );
        return;
      }

      const processName = process.env.PM2_PROCESS_NAME || 'assistant-bot';
      const command = `pm2 stop ${processName}`;
      const result = await runCommand(command);

      await ctx.replyWithHTML(
        `<b>⏹️ Kết quả stop</b>\n<pre>${escapeHtml(formatResult(command, result))}</pre>`,
      );
    } catch (error) {
      console.error('[STOP_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể stop process lúc này.');
    }
  },
};