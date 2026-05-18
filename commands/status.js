const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

      const cpuValue = escapeHtml(formatPercent(cpuUsage));
      const ramUsed = escapeHtml(formatBytes(memory?.used || 0));
      const ramTotal = escapeHtml(formatBytes(memory?.total || 0));
      const ramPercent = escapeHtml(formatPercent(ramUsagePercent));
      const swapUsed = escapeHtml(formatBytes(memory?.swapused || 0));
      const swapTotal = escapeHtml(formatBytes(memory?.swaptotal || 0));
      const diskFree = escapeHtml(formatBytes(rootDisk?.available || 0));

      const reportLines = [
        '🖥️ <b>Báo cáo trạng thái server</b>',
        `<b>CPU:</b> <code>${cpuValue}</code>${cpuWarn}`,
        `<b>RAM:</b> <code>${ramUsed} / ${ramTotal}</code> (${ramPercent})${ramWarn}`,
        `<b>SWAP:</b> <code>${swapUsed} / ${swapTotal}</code>`,
        `<b>Disk (/):</b> <code>${diskFree} còn trống</code>`,
      ];

      await ctx.reply(reportLines.join('\n'), { parse_mode: 'HTML' });
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  });
}

module.exports = { registerStatusCommand };
