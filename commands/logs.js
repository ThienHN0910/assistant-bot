const fs = require('fs/promises');
const { readLastLines } = require('../config/utils');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function registerLogsCommand(bot, config) {
  bot.command('logs', async (ctx) => {
    try {
      // Ensure the path exists and is readable
      await fs.access(config.pm2ErrorLogPath);
      const logTail = await readLastLines(config.pm2ErrorLogPath, 20);
      const output = logTail.trim() || 'Không có log lỗi.';

      // Use HTML <pre> to avoid Markdown escaping issues with raw logs
      await ctx.reply(`🧾 <b>20 dòng log lỗi PM2 gần nhất:</b>\n<pre>${escapeHtml(output)}</pre>`, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('[LOGS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc file log PM2. Kiểm tra lại PM2_ERROR_LOG_PATH.');
    }
  });
}

module.exports = { registerLogsCommand };
