const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

function registerStatusCommand(bot) {
  bot.command('status', async (ctx) => {
    try {
      // Get metrics in parallel where possible
      const [cpuLoad, memory, fileSystems] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const rootDisk = (Array.isArray(fileSystems) && fileSystems.length > 0)
        ? (fileSystems.find((item) => item.mount === '/') || fileSystems[0])
        : { available: 0 };

      const cpuUsage = Number(cpuLoad?.currentLoad) || 0;
      const ramUsagePercent = memory && memory.total ? (memory.used / memory.total) * 100 : 0;
      const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
      const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

      const reportLines = [
        '🖥️ Báo cáo trạng thái server',
        `• CPU: ${formatPercent(cpuUsage)}${cpuWarn}`,
        `• RAM: ${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)} (${formatPercent(ramUsagePercent)})${ramWarn}`,
        `• SWAP: ${formatBytes(memory?.swapused || 0)} / ${formatBytes(memory?.swaptotal || 0)}`,
        `• Disk (/): ${formatBytes(rootDisk?.available || 0)} còn trống`,
      ];

      await ctx.reply(reportLines.join('\n'), { parse_mode: 'HTML' });
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  });
}

module.exports = { registerStatusCommand };
