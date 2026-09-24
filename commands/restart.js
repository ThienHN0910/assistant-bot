const { exec } = require('child_process');

module.exports = {
  name: 'restart',
  description: 'Khởi động lại bot từ xa qua PM2 an toàn',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /restart</b>\n` +
          `Khởi động lại tiến trình PM2 quản lý bot từ xa mà không làm gián đoạn điều khiển.\n\n` +
          `<b>Cú pháp:</b> <code>/restart</code>\n` +
          `<b>Ví dụ:</b> <code>/restart</code>`
        );
        return;
      }

      const processName = process.env.PM2_PROCESS_NAME || 'assistant-bot';

      await ctx.replyWithHTML(
        `🔄 <b>Đang khởi động lại Bot...</b>\n` +
        `<i>Tiến trình PM2 "<code>${processName}</code>" sẽ khởi động lại trong 1-2 giây tới.</i>`
      );

      setTimeout(() => {
        exec(`pm2 restart ${processName} --update-env`, (error, stdout, stderr) => {
          if (error) {
            console.error('[RESTART_EXEC_ERROR]', error, stderr);
          } else {
            console.log('[RESTART_EXEC_SUCCESS]', stdout);
          }
        });
      }, 1200);
    } catch (error) {
      console.error('[RESTART_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể kích hoạt khởi động lại bot lúc này.');
    }
  },
};
