const si = require('systeminformation');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
const { escapeHtml } = require('../config/utils');

function formatDuration(seconds) {
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days} ngày, ${hours} giờ, ${minutes} phút, ${secs} giây`;
}

module.exports = {
    name: 'uptime',
    description: 'Xem thời gian uptime của server',
    async execute(ctx, config = {}, deps = {}) {
        try {
            const text = ctx.message?.text || '';
            const args = text.trim().split(/\s+/).slice(1);
            if (args.includes('-h') || args.includes('--help')) {
                await ctx.replyWithHTML(
                    `ℹ️ <b>Hướng dẫn lệnh /uptime</b>\n` +
                    `Xem thời gian máy chủ đã hoạt động liên tục (uptime) và thời điểm boot máy chủ.\n\n` +
                    `<b>Cú pháp:</b> <code>/uptime</code>\n` +
                    `<b>Ví dụ:</b> <code>/uptime</code>`
                );
                return;
            }

            const manager = deps.nodeManager || nodeManager;
            const nodes = args[0] ? [await manager.getNode(args[0], config)].filter(Boolean) : await manager.getNodes(config);
            if (!nodes.length) { await ctx.replyWithHTML('⚠️ Node không tồn tại.'); return; }
            const blocks = await Promise.all(nodes.map(async (node) => {
                const label = escapeHtml(node.name || node.id);
                if (node.isLocal) return `${label}: ${formatDuration((deps.si || si).time().uptime)}`;
                try {
                    const result = await (deps.nodeClient || nodeClient).getMetrics(node);
                    return result.ok ? `${label}: ${formatDuration(result.metrics?.uptimeSeconds || 0)}` : `${label}: offline`;
                } catch { return `${label}: offline`; }
            }));
            await ctx.replyWithHTML(`⏱️ <b>Uptime cụm VPS</b>\n${blocks.join('\n')}`);
        } catch (error) {
            console.error('[UPTIME_COMMAND_ERROR]', error);
            try {
                await ctx.reply('⚠️ Không thể lấy thời gian hoạt động của server lúc này.');
            } catch (e) {
                console.error('[UPTIME_FALLBACK_ERROR]', e);
            }
        }
    }
};
