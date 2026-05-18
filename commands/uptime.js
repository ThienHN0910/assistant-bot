const si = require('systeminformation');

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days} ngày ${hours} giờ ${minutes} phút`;
}

function registerUptimeCommand(bot) {
  bot.command('uptime', async (ctx) => {
    try {
      const uptimeSeconds = await si.time().then((t) => t.uptime);
      await ctx.reply(`⏱️ Uptime server: *${formatDuration(uptimeSeconds)}*`, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error('[UPTIME_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy uptime server lúc này.');
    }
  });
}

module.exports = { registerUptimeCommand };
