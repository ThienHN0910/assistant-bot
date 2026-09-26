const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
const { escapeHtml } = require('../config/utils');

module.exports = {
  name: 'nodes',
  description: 'Xem danh sách các máy chủ trong cụm (Multi-VPS)',
  execute: async (ctx, configOrDeps = {}, maybeDeps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /nodes</b>\n` +
          `Xem danh sách các máy chủ (nodes) đã đăng ký trong cụm Multi-VPS kèm trạng thái kết nối.\n\n` +
          `<b>Cú pháp:</b> <code>/nodes</code>\n` +
          `<b>Ví dụ:</b> <code>/nodes</code>`
        );
        return;
      }

      const deps = (configOrDeps && (configOrDeps.nodeManager || configOrDeps.nodeClient))
        ? configOrDeps
        : (maybeDeps || {});
      const config = (deps === configOrDeps) ? {} : (configOrDeps || {});

      const depNodeManager = deps.nodeManager || config.nodeManager || nodeManager;
      const depNodeClient = deps.nodeClient || config.nodeClient || nodeClient;

      const nodes = await depNodeManager.getNodes(config);
      if (!nodes || nodes.length === 0) {
        await ctx.replyWithHTML('ℹ️ Không có máy chủ nào được đăng ký trong hệ thống.');
        return;
      }

      const lines = ['🌐 <b>Danh sách máy chủ trong cụm Multi-VPS:</b>\n'];

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const maskedIp = depNodeManager.maskIp ? depNodeManager.maskIp(node.ip) : (node.ip || 'N/A');
        let statusText = '';

        if (node.isLocal) {
          statusText = '👑 <b>Master</b> (Online)';
        } else {
          const start = Date.now();
          try {
            const res = await depNodeClient.getMetrics(node);
            const latency = Date.now() - start;
            if (res && res.ok) {
              statusText = `🟢 <b>Online</b> (${latency}ms)`;
            } else {
              statusText = `🔴 <b>Offline</b> (${escapeHtml(res?.error || 'Không phản hồi')})`;
            }
          } catch (err) {
            statusText = `🔴 <b>Offline</b> (${escapeHtml(err.message)})`;
          }
        }

        lines.push(`${i + 1}. <b>${escapeHtml(node.name || node.id)}</b> (<code>${escapeHtml(node.id)}</code>)`);
        lines.push(`   • IP: <code>${escapeHtml(maskedIp)}</code>`);
        lines.push(`   • Trạng thái: ${statusText}`);
        if (i < nodes.length - 1) lines.push('');
      }

      await ctx.replyWithHTML(lines.join('\n'));
    } catch (error) {
      console.error('[NODES_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể kiểm tra danh sách máy chủ lúc này.');
    }
  },
};
