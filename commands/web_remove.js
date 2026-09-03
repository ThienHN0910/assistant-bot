const sandbox = require('../lib/sandbox');
const { escapeHtml } = require('../config/utils');

module.exports = {
  name: 'web_remove',
  description: 'Gỡ bỏ một web test khỏi server và giải phóng dung lượng đĩa',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (!args.length || args.includes('-h') || args.includes('--help')) {
        const deployments = await sandbox.listDeployments(config.webDeployDir);
        const listText = deployments.length
          ? deployments.map((d) => `• <code>${d.name}</code> (Port: ${d.port})`).join('\n')
          : '<i>(Hiện không có web nào đang chạy)</i>';

        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /web_remove</b>\n` +
          `Dừng tiến trình PM2 (nếu có), xóa virtual host Nginx và xóa sạch thư mục dự án để giải phóng ổ đĩa.\n\n` +
          `<b>Cú pháp:</b> <code>/web_remove &lt;tên_project&gt;</code>\n\n` +
          `<b>Các dự án hiện có:</b>\n${listText}\n\n` +
          `<b>Ví dụ:</b> <code>/web_remove my-portfolio</code>`
        );
        return;
      }

      const projectName = args[0];
      await ctx.replyWithHTML(`⏳ <b>Đang gỡ bỏ dự án "${escapeHtml(projectName)}"...</b>`);

      await sandbox.removeProject(projectName, config);

      await ctx.replyWithHTML(
        `✅ <b>ĐÃ GỠ BỎ THÀNH CÔNG DỰ ÁN "${escapeHtml(projectName)}"!</b>\n\n` +
        `• Đã xóa virtual host Nginx và reload cấu hình.\n` +
        `• Đã dừng tiến trình PM2 liên quan (nếu có).\n` +
        `• Đã xóa thư mục dự án, giải phóng dung lượng đĩa.`
      );
    } catch (error) {
      console.error('[WEB_REMOVE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML(`⚠️ <b>Lỗi khi gỡ bỏ web:</b> ${escapeHtml(error.message || String(error))}`);
    }
  },
};
