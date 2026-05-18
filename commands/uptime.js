const si = require('systeminformation');

function escapeMarkdown(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/[_\[\]\(\)~>#+=\-\|{}\.!]/g, '\\$&');
}

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
    async execute(ctx) {
        try {
            // si.time() is synchronous in this environment
            const timeData = si.time();
            const uptimeSeconds = (timeData && typeof timeData.uptime === 'number') ? timeData.uptime : 0;

            const durationText = formatDuration(uptimeSeconds);
            const bootRaw = timeData && (timeData.boot || timeData.boot_time || timeData.bootTime || timeData.boottime);
            const bootText = bootRaw ? new Date(bootRaw).toLocaleString('vi-VN') : null;

            const lines = [];
            lines.push('⏱️ *TRẠNG THÁI HOẠT ĐỘNG SERVER*');
            lines.push('');
            lines.push(`• *Thời gian đã chạy:* \`${escapeMarkdown(durationText)}\``);
            if (bootText) {
                lines.push(`• *Khởi động lúc:* \`${escapeMarkdown(bootText)}\``);
            }

            await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
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