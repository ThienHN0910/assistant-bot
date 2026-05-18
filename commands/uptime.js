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
      // si.time() may be synchronous in some versions of systeminformation.
      // Support both synchronous return and Promise return without using .then().
      const timeResult = si.time();
      const resolved = typeof timeResult?.then === 'function' ? await timeResult : timeResult;
      const uptimeSeconds = (resolved && typeof resolved.uptime === 'number') ? resolved.uptime : 0;

      await ctx.reply(`⏱️ Uptime server: <b>${formatDuration(uptimeSeconds)}</b>`, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('[UPTIME_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy uptime server lúc này.');
    }
  });
}

module.exports = { registerUptimeCommand };
