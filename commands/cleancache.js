const { promisify } = require('util');
const { exec } = require('child_process');
const si = require('systeminformation');
const { escapeHtml, formatBytes, formatPercent } = require('../config/utils');

const execAsync = promisify(exec);

async function runShellCommand(command) {
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

function formatCommandResult(label, result) {
  const lines = [];
  lines.push(`${label}: ${result.ok ? '✅ Thành công' : '❌ Thất bại'}`);

  if (result.stdout) {
    lines.push('stdout:');
    lines.push(result.stdout.trimEnd());
  }

  if (result.stderr) {
    lines.push('stderr:');
    lines.push(result.stderr.trimEnd());
  }

  if (typeof result.code !== 'undefined') {
    lines.push(`exit code: ${result.code}`);
  }

  return lines.join('\n');
}

async function getCurrentMemoryLine() {
  const memory = await si.mem();
  return `RAM hiện tại: ${formatBytes(memory.used)} / ${formatBytes(memory.total)} (${formatPercent((memory.used / memory.total) * 100)})`;
}

module.exports = {
  name: 'cleancache',
  description: 'Dọn cache an toàn và flush log PM2',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /cleancache</b>\n` +
          `Dọn dẹp bộ nhớ đệm (RAM cache) và xóa sạch lịch sử log PM2 để giải phóng dung lượng đĩa máy chủ.\n\n` +
          `<b>Cú pháp:</b> <code>/cleancache</code>\n` +
          `<b>Ví dụ:</b> <code>/cleancache</code>`
        );
        return;
      }

      const cacheCommand = process.platform === 'linux'
        ? 'sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches'
        : null;
      const pm2Command = 'pm2 flush';

      const cacheResult = cacheCommand
        ? await runShellCommand(cacheCommand)
        : {
            ok: false,
            stdout: '',
            stderr: 'Lệnh xả RAM đệm chỉ hỗ trợ trên Linux.',
            skipped: true,
          };
      const pm2Result = await runShellCommand(pm2Command);

      const report = [];
      report.push('<b>🧹 Kết quả dọn cache</b>');
      report.push('<pre>');
      report.push(escapeHtml(formatCommandResult('1) Xả RAM đệm', cacheResult)));
      report.push('');
      report.push(escapeHtml(formatCommandResult('2) Xóa log PM2 cũ', pm2Result)));
      report.push('</pre>');

      if (cacheResult.ok) {
        try {
          const memoryLine = await getCurrentMemoryLine();
          report.push(`<b>${escapeHtml(memoryLine)}</b>`);
        } catch (memoryError) {
          console.error('[CLEANCACHE_MEMORY_ERROR]', memoryError);
          report.push('<i>Không thể lấy trạng thái RAM sau khi dọn cache.</i>');
        }
      } else if (cacheResult.skipped) {
        report.push('<i>Bỏ qua bước xả RAM đệm vì môi trường hiện tại không hỗ trợ.</i>');
      }

      await ctx.replyWithHTML(report.join('\n'));
    } catch (error) {
      console.error('[CLEANCACHE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh dọn cache lúc này.');
    }
  },
};