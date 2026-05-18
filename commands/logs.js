const fs = require('fs/promises');
const { readLastLines } = require('../config/utils');

function registerLogsCommand(bot, config) {
  bot.command('logs', async (ctx) => {
    try {
      await fs.access(config.pm2ErrorLogPath);
      const logTail = await readLastLines(config.pm2ErrorLogPath, 20);
      const output = logTail.trim() || 'Không có log lỗi.';

      await ctx.reply(`🧾 *20 dòng log lỗi PM2 gần nhất:*\n\n\`\`\`text\n${output}\n\`\`\``, {
        parse_mode: 'MarkdownV2',
      });
    } catch (error) {
      console.error('[LOGS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc file log PM2. Kiểm tra lại PM2_ERROR_LOG_PATH.');
    }
  });
}

module.exports = { registerLogsCommand };
