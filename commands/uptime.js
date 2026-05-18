const si = require('systeminformation');

module.exports = {
    name: 'uptime',
    description: 'Xem thời gian uptime của server',
    async execute(ctx) {
        try {
            // Hàm si.time() là hàm đồng bộ (Synchronous), không dùng .then() hay await ở đây
            const timeData = si.time();
            const uptimeSeconds = timeData.uptime;

            const days = Math.floor(uptimeSeconds / (24 * 3600));
            const hours = Math.floor((uptimeSeconds % (24 * 3600)) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = Math.floor(uptimeSeconds % 60);

            const message = `⏱️ <b>TRẠNG THÁI HOẠT ĐỘNG SERVER</b>\n\n` +
                            `• <b>Thời gian đã chạy:</b> <code>${days} ngày, ${hours} giờ, ${minutes} phút, ${seconds} giây</code>\n` +
                            `• <b>Khởi động lúc:</b> <code>${new Date(timeData.boot_time).toLocaleString('vi-VN')}</code>`;

            await ctx.replyWithHTML(message);
        } catch (error) {
            console.error('[UPTIME_COMMAND_ERROR]', error);
            await ctx.reply('⚠️ Không thể lấy thời gian hoạt động của server lúc này.');
        }
    }
};