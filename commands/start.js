function registerStartCommand(bot) {
  bot.command('start', async (ctx) => {
    try {
      const message = [
        '👋 *Chào mừng đến với Dev Assistant Bot*',
        '',
        '🤖 Bot trợ lý cá nhân dành cho lập trình viên\!',
        '',
        '📋 *Danh sách lệnh:*',
        '- /start \- Hiển thị menu hướng dẫn',
        '- /status \- Xem tài nguyên server realtime',
        '- /ip \- Lấy IP public hiện tại',
        '- /logs \- Xem 20 dòng log lỗi PM2 gần nhất',
        '- /uptime \- Xem thời gian uptime của server',
        '',
        '📝 *Snippet ghi chú:*',
        'Gửi text thường \(không bắt đầu bằng `/`\) để lưu vào `notes\.txt`\.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('[START_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hiển thị menu lúc này.');
    }
  });
}

module.exports = { registerStartCommand };
