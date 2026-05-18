const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

function registerStatusCommand(bot) {
  bot.command('status', async (ctx) => {
    try {
      const [cpuLoad, memory, fileSystems] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const rootDisk = fileSystems.find((item) => item.mount === '/') || fileSystems[0] || { available: 0 };

      const cpuUsage = cpuLoad.currentLoad;
      const ramUsagePercent = (memory.used / memory.total) * 100;
      const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
      const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

      const report = [
        '🖥️ *Báo cáo trạng thái server*',
        '',
        `• CPU: *${formatPercent(cpuUsage)}*${cpuWarn}`,
        `• RAM: *${formatBytes(memory.used)} / ${formatBytes(memory.total)}* \(${formatPercent(ramUsagePercent)}\)${ramWarn}`,
        `• SWAP: *${formatBytes(memory.swapused)} / ${formatBytes(memory.swaptotal)}*`,
        `• Disk / còn trống: *${formatBytes(rootDisk.available)}*`,
      ].join('\n');

      await ctx.reply(report, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  });
}

module.exports = { registerStatusCommand };
