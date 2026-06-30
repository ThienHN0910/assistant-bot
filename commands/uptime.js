const si = require('systeminformation');

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

            // si.time() trả về dữ liệu đồng bộ (synchronous)
            const timeData = si.time();
            const uptimeSeconds = (timeData && typeof timeData.uptime === 'number') ? timeData.uptime : 0;

            const durationText = formatDuration(uptimeSeconds);
            const bootRaw = timeData && (timeData.boot || timeData.boot_time || timeData.bootTime || timeData.boottime);
            const bootText = bootRaw ? new Date(bootRaw).toLocaleString('vi-VN') : null;

            const lines = [];
            // Sử dụng các thẻ HTML: <b> để in đậm, <code> để tạo khối text monospace (code block)
            lines.push('⏱️ <b>TRẠNG THÁI HOẠT ĐỘNG SERVER</b>');
            lines.push('');
            lines.push(`• <b>Thời gian đã chạy:</b> <code>${durationText}</code>`);
            if (bootText) {
                lines.push(`• <b>Khởi động lúc:</b> <code>${bootText}</code>`);
            }

            // Gửi tin nhắn bằng hàm replyWithHTML cực kỳ an toàn
            await ctx.replyWithHTML(lines.join('\n'));
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