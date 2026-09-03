const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const sandbox = require('../lib/sandbox');
const { escapeHtml } = require('../config/utils');

async function getPublicIp() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    return res.data?.ip || 'localhost';
  } catch {
    return 'localhost';
  }
}

async function handleDeployExecution(ctx, zipName, config, requestedPort = null) {
  try {
    let zipPath = path.join(config.uploadDir, zipName);
    if (!fsSync.existsSync(zipPath)) {
      const parentZip = path.join(path.dirname(config.uploadDir), zipName);
      if (fsSync.existsSync(parentZip)) {
        zipPath = parentZip;
      }
    }
    const projectName = path.parse(zipName).name;
    const port = requestedPort || (await sandbox.getNextAvailablePort(config.webDeployDir, config.webPortStart));

    await ctx.replyWithHTML(
      `⚙️ <b>Đang tiến hành Deploy dự án "${escapeHtml(projectName)}"...</b>\n` +
      `• File: <code>${escapeHtml(zipName)}</code>\n` +
      `• Cấp phát Port: <b>${port}</b>\n` +
      `<i>Vui lòng đợi vài giây...</i>`
    );

    const result = await sandbox.deployProject(zipPath, projectName, port, config);
    const publicIp = await getPublicIp();
    const url = `http://${publicIp}:${result.port}`;

    await ctx.replyWithHTML(
      `🎉 <b>DEPLOY THÀNH CÔNG!</b>\n\n` +
      `• Dự án: <b>${escapeHtml(result.name)}</b>\n` +
      `• Loại hình: <code>${result.type === 'backend' ? 'Node.js Backend' : 'Web Tĩnh / SPA'}</code>\n` +
      `• Port: <b>${result.port}</b>\n` +
      `• URL truy cập: <a href="${url}">${url}</a>\n\n` +
      `<i>Tiện ích tiếp theo:</i>\n` +
      `• Kiểm tra hiệu năng: <code>/perf ${result.port}</code>\n` +
      `• Xem danh sách web: <code>/web_list</code>\n` +
      `• Gỡ bỏ web khi xong: <code>/web_remove ${result.name}</code>`
    );
  } catch (err) {
    console.error('[DEPLOY_EXECUTION_ERROR]', err);
    await ctx.replyWithHTML(`❌ <b>Lỗi khi deploy:</b> ${escapeHtml(err.message || String(err))}`);
  }
}

module.exports = {
  name: 'deploy',
  description: 'Deploy web cá nhân chỉ với 1 thao tác (hỗ trợ chọn file ZIP)',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /deploy</b>\n` +
          `Tự động giải nén, phát hiện loại dự án (Web tĩnh hoặc Node.js Backend), cấu hình Nginx port-based và PM2.\n\n` +
          `<b>Cách 1 (Bấm nút trên Telegram):</b> Gõ <code>/deploy</code> để hiện danh sách file .zip có sẵn.\n` +
          `<b>Cách 2 (Gõ lệnh trực tiếp):</b> <code>/deploy &lt;tên_file.zip&gt; [port]</code>\n\n` +
          `<b>Ví dụ:</b> <code>/deploy my-portfolio.zip</code>`
        );
        return;
      }

      // Nếu truyền thẳng tên file qua tham số: /deploy app.zip 8085
      if (args.length > 0) {
        const zipArg = args[0].endsWith('.zip') ? args[0] : `${args[0]}.zip`;
        const portArg = args[1] ? Number(args[1]) : null;
        await handleDeployExecution(ctx, zipArg, config, portArg);
        return;
      }

      // Không truyền tham số: quét thư mục upload và tạo inline buttons
      const zips = await sandbox.listUploadZipFiles(config.uploadDir);

      if (!zips.length) {
        await ctx.replyWithHTML(
          `📦 <b>Không tìm thấy file .zip nào trong thư mục upload!</b>\n\n` +
          `• Thư mục upload: <code>${escapeHtml(config.uploadDir)}</code>\n\n` +
          `<b>Hướng dẫn upload từ máy tính:</b>\n` +
          `<code>gcloud compute scp my-app.zip &lt;tên_vps&gt;:${escapeHtml(config.uploadDir)}/</code>\n` +
          `<i>hoặc dùng lệnh scp / sftp tương tự.</i>`
        );
        return;
      }

      const buttons = zips.slice(0, 10).map((z) => [
        {
          text: `📦 ${z.name} (${z.sizeFormatted})`,
          callback_data: `deploy_zip:${z.name}`,
        },
      ]);

      await ctx.replyWithHTML(
        `🚀 <b>DANH SÁCH FILE ZIP SẴN SÀNG DEPLOY</b>\n` +
        `<i>Bấm vào file bạn muốn triển khai lên server:</i>`,
        {
          reply_markup: {
            inline_keyboard: buttons,
          },
        }
      );
    } catch (error) {
      console.error('[DEPLOY_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể kiểm tra danh sách file deploy lúc này.');
    }
  },

  register: (bot, config) => {
    // Lắng nghe sự kiện bấm nút Inline Button
    bot.action(/^deploy_zip:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('Bắt đầu deploy...');
        const zipName = ctx.match[1];
        await handleDeployExecution(ctx, zipName, config);
      } catch (err) {
        console.error('[DEPLOY_ACTION_ERROR]', err);
        await ctx.reply('⚠️ Lỗi khi xử lý thao tác deploy.');
      }
    });
  },
};
