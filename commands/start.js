function registerStartCommand(bot) {
  bot.command('start', async (ctx) => {
    try {
      const messageLines = [
        '👋 <b>Chào mừng đến với Dev Assistant Bot</b>',
        '🤖 Bot trợ lý cá nhân dành cho lập trình viên',
        '',
        '<b>Danh sách lệnh:</b>',
        '<code>/start</code> — Hiển thị menu hướng dẫn',
        '<code>/status</code> — Xem tài nguyên server realtime',
        '<code>/ip</code> — Lấy IP public hiện tại',
        '<code>/logs</code> — Xem 20 dòng log lỗi PM2 gần nhất',
        '<code>/uptime</code> — Xem thời gian uptime của server',
        '',
        'Gửi text thường (không bắt đầu bằng <code>/</code>) để lưu vào file ghi chú.',
      ];

      // Reply keyboard compatible with Telegraf v4 (reply_markup)
      const replyOptions = {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [['/status', '/ip'], ['/logs', '/uptime']],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      };

      await ctx.reply(messageLines.join('\n'), replyOptions);
    } catch (error) {
      console.error('[START_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hiển thị menu lúc này.');
    }
  });
}

module.exports = { registerStartCommand };
