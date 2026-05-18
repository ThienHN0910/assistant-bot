const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

function escapeMarkdown(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/[_\[\]\(\)~>#+=\-\|{}\.!]/g, '\\$&');
}

module.exports = {
  name: 'status',
  description: 'Báo cáo trạng thái server',
  execute: async (ctx) => {
    try {
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

      const cpuValue = escapeMarkdown(formatPercent(cpuUsage));
      const ramUsed = escapeMarkdown(formatBytes(memory?.used || 0));
      const ramTotal = escapeMarkdown(formatBytes(memory?.total || 0));
      const ramPercent = escapeMarkdown(formatPercent(ramUsagePercent));
      const swapUsed = escapeMarkdown(formatBytes(memory?.swapused || 0));
      const swapTotal = escapeMarkdown(formatBytes(memory?.swaptotal || 0));
      const diskFree = escapeMarkdown(formatBytes(rootDisk?.available || 0));

      const lines = [];
      lines.push('🖥️ *Báo cáo trạng thái server*');
      lines.push(`• CPU: *${cpuValue}*${cpuWarn}`);
      lines.push(`• RAM: *${ramUsed} / ${ramTotal}* (${ramPercent})${ramWarn}`);
      lines.push(`• SWAP: *${swapUsed} / ${swapTotal}*`);
      lines.push(`• Disk (/): *${diskFree}* còn trống`);

      await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      try {
        await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
      } catch (e) {
        console.error('[STATUS_FALLBACK_ERROR]', e);
      }
    }
  },
};
