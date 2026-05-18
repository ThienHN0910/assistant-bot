function registerStartCommand(bot) {
  bot.command('start', async (ctx) => {
    try {
      const message = [];
      message.push('👋 <b>Chào mừng đến với Dev Assistant Bot</b>');
      message.push('🤖 Bot trợ lý cá nhân dành cho lập trình viên');
      message.push('');
      message.push('<b>Danh sách lệnh:</b>');
      message.push('/start — Hiển thị menu hướng dẫn');
      message.push('/status — Xem tài nguyên server realtime');
      message.push('/ip — Lấy IP public hiện tại');
      message.push('/logs — Xem 20 dòng log lỗi PM2 gần nhất');
      message.push('/uptime — Xem thời gian uptime của server');
      message.push('');
      message.push('Gửi text thường (không bắt đầu bằng `/`) để lưu vào file ghi chú.');

      // Simple reply keyboard compatible with Telegraf v4
      const keyboard = {
        reply_markup: {
          keyboard: [["/status", "/ip"], ["/logs", "/uptime"]],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      };

      await ctx.reply(message.join('\n'), { parse_mode: 'HTML', ...keyboard });
    } catch (error) {
      console.error('[START_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hiển thị menu lúc này.');
    }
  });
}

module.exports = { registerStartCommand };
