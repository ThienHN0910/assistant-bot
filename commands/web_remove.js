const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');

module.exports = {
  name: 'web_remove',
  description: 'Gỡ bỏ một dự án web khỏi server / cloud và giải phóng tài nguyên',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (!args.length || args.includes('-h') || args.includes('--help')) {
        const deployments = await deployer.listAllDeployments(config);
        const listText = deployments.length
          ? deployments.map((d) => `• <code>${escapeHtml(d.name)}</code> [${d.target.toUpperCase()}] (${escapeHtml(d.domain || '')})`).join('\n')
          : '<i>(Hiện không có web nào đang chạy)</i>';

        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /web_remove</b>\n` +
          `Dừng ứng dụng, xóa virtual host / cloud service, xóa DNS Cloudflare (A / CNAME) và giải phóng tài nguyên.\n\n` +
          `<b>Cú pháp:</b> <code>/web_remove &lt;tên_project&gt;</code>\n\n` +
          `<b>Các dự án hiện có:</b>\n${listText}\n\n` +
          `<b>Ví dụ:</b> <code>/web_remove my-portfolio</code>`
        );
        return;
      }

      const projectName = args[0];
      await ctx.replyWithHTML(`⏳ <b>Đang gỡ bỏ dự án "${escapeHtml(projectName)}"...</b>`);

      const res = await deployer.undeploy(projectName, config);

      await ctx.replyWithHTML(
        `✅ <b>ĐÃ GỠ BỎ THÀNH CÔNG DỰ ÁN "${escapeHtml(res.name)}"!</b>\n\n` +
        `• Nền tảng: <code>${res.target.toUpperCase()}</code>\n` +
        `• Đã xóa cấu hình và dịch vụ liên quan.\n` +
        (res.dnsDeleted ? `• Đã xóa bản ghi DNS thuộc deployment.` : `• Deployment này không có bản ghi DNS thuộc bot.`)
      );
    } catch (error) {
      console.error('[WEB_REMOVE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML(`⚠️ <b>Lỗi khi gỡ bỏ web:</b> ${escapeHtml(error.message || String(error))}`);
    }
  },
};
