const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

module.exports = {
  name: 'status',
  description: 'Báo cáo trạng thái server',
  execute: async (ctx, configOrDeps = {}, maybeDeps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /status</b>\n` +
          `Xem trạng thái tài nguyên phần cứng thời gian thực của máy chủ hoặc cụm Multi-VPS.\n\n` +
          `<b>Cú pháp:</b> <code>/status</code>\n` +
          `<b>Thông số trả về:</b> CPU (%), RAM (đã dùng/tổng), SWAP, Disk và trạng thái các node trong cụm.\n` +
          `<b>Ví dụ:</b> <code>/status</code>`
        );
        return;
      }

      const deps = (configOrDeps && (configOrDeps.nodeManager || configOrDeps.nodeClient || configOrDeps.si))
        ? configOrDeps
        : (maybeDeps || {});
      const config = (deps === configOrDeps) ? {} : (configOrDeps || {});

      const depNodeManager = deps.nodeManager || config.nodeManager || nodeManager;
      const depNodeClient = deps.nodeClient || config.nodeClient || nodeClient;
      const depSi = deps.si || config.si || si;

      const nodes = await depNodeManager.getNodes(config);
      const nodeBlocks = await Promise.all(
        nodes.map(async (node) => {
          const maskedIp = depNodeManager.maskIp ? depNodeManager.maskIp(node.ip) : (node.ip ? `${node.ip.split('.')[0]}.***.***` : '');
          const nodeTitle = `🖥️ <b>${node.name || node.id}</b> (<code>${maskedIp}</code>)${node.isLocal ? ' <i>[Master]</i>' : ''}`;

          if (node.isLocal) {
            try {
              const [cpuLoad, memory, fileSystems] = await Promise.all([
                depSi.currentLoad().catch(() => ({ currentLoad: 0 })),
                depSi.mem().catch(() => ({ used: 0, total: 0, swapused: 0, swaptotal: 0 })),
                depSi.fsSize().catch(() => []),
              ]);

              const rootDisk = (Array.isArray(fileSystems) && fileSystems.length > 0)
                ? (fileSystems.find((item) => item.mount === '/') || fileSystems[0])
                : { available: 0 };

              const cpuUsage = Number(cpuLoad?.currentLoad) || 0;
              const ramUsagePercent = memory && memory.total ? (memory.used / memory.total) * 100 : 0;
              const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
              const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

              const lines = [
                `• CPU: <b>${formatPercent(cpuUsage)}</b>${cpuWarn}`,
                `• RAM: <b>${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)}</b> (${formatPercent(ramUsagePercent)})${ramWarn}`,
              ];
              if (memory?.swaptotal) {
                lines.push(`• SWAP: <b>${formatBytes(memory?.swapused || 0)} / ${formatBytes(memory?.swaptotal || 0)}</b>`);
              }
              if (rootDisk?.available) {
                lines.push(`• Disk (/): <b>${formatBytes(rootDisk?.available || 0)}</b> còn trống`);
              }

              return { title: nodeTitle, lines };
            } catch (localErr) {
              return {
                title: nodeTitle,
                lines: [`• Trạng thái: ⚠️ <i>Lỗi đọc dữ liệu local (${localErr.message})</i>`],
              };
            }
          } else {
            try {
              const res = await depNodeClient.getMetrics(node);
              if (res && res.ok && res.metrics) {
                const cpuUsage = Number(res.metrics.cpuLoad) || 0;
                const memUsed = res.metrics.memory?.usedBytes || 0;
                const memTotal = res.metrics.memory?.totalBytes || 0;
                const ramUsagePercent = memTotal > 0
                  ? (memUsed / memTotal) * 100
                  : (Number(res.metrics.memory?.usedPercentage) || 0);
                const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
                const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

                const lines = [
                  `• CPU: <b>${formatPercent(cpuUsage)}</b>${cpuWarn}`,
                  `• RAM: <b>${formatBytes(memUsed)} / ${formatBytes(memTotal)}</b> (${formatPercent(ramUsagePercent)})${ramWarn}`,
                ];
                return { title: nodeTitle, lines };
              }
              return {
                title: nodeTitle,
                lines: [`• Trạng thái: 🔴 <i>Offline / Không phản hồi (${res?.error || 'Lỗi kết nối'})</i>`],
              };
            } catch (remoteErr) {
              return {
                title: nodeTitle,
                lines: [`• Trạng thái: 🔴 <i>Offline / Không phản hồi (${remoteErr.message})</i>`],
              };
            }
          }
        })
      );


      const outputLines = [];
      outputLines.push('📊 <b>Báo cáo trạng thái máy chủ</b>\n');
      for (const block of nodeBlocks) {
        outputLines.push(block.title);
        outputLines.push(...block.lines);
        outputLines.push('');
      }

      await ctx.replyWithHTML(outputLines.join('\n').trim());
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  },
};