const fsSync = require('fs');
const path = require('path');
const deployer = require('../lib/deployer');
const sandbox = require('../lib/sandbox');
const deployStore = require('../lib/deployStore');
const nodeManager = require('../lib/nodeManager');
const { escapeHtml } = require('../config/utils');

async function handleZipDeploy(ctx, zipName, target = 'vps', config, options = {}) {
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$/i.test(zipName) || zipName.includes('..')) {
      throw new Error('Tên file ZIP không hợp lệ');
    }
    let zipPath = path.join(config.uploadDir, zipName);
    if (!fsSync.existsSync(zipPath)) {
      const parentZip = path.join(path.dirname(config.uploadDir), zipName);
      if (fsSync.existsSync(parentZip)) {
        zipPath = parentZip;
      }
    }

    const projectName = path.parse(zipName).name;

    await ctx.replyWithHTML(
      `⚙️ <b>Đang tiến hành Deploy dự án "${escapeHtml(projectName)}"...</b>\n` +
      `• File: <code>${escapeHtml(zipName)}</code>\n` +
      `• Nền tảng: <b>${escapeHtml(target.toUpperCase())}</b>${options.nodeId ? ` (Node: <code>${escapeHtml(options.nodeId)}</code>)` : ''}\n` +
      `<i>Vui lòng đợi vài giây trong khi thiết lập...</i>`
    );

    const result = await deployer.deploy(
      {
        source: 'zip_upload',
        sourcePath: zipPath,
        projectName,
        target,
        nodeId: options.nodeId,
      },
      config
    );

    const dep = result.deployment;

    await ctx.replyWithHTML(
      `🎉 <b>DEPLOY THÀNH CÔNG!</b>\n\n` +
      `• Dự án: <b>${escapeHtml(dep.name)}</b>\n` +
      `• Nền tảng: <code>${dep.target.toUpperCase()}</code>${dep.nodeId ? ` (Node: <code>${escapeHtml(dep.nodeId)}</code>)` : ''}\n` +
      `• Loại hình: <code>${dep.type === 'backend' ? 'Node.js Backend' : 'Web Tĩnh / SPA'}</code>\n` +
      `• Tên miền: <code>${escapeHtml(dep.domain || '')}</code>\n` +
      `• URL truy cập: <a href="${escapeHtml(dep.url)}">${escapeHtml(dep.url)}</a>\n\n` +
      `<i>Tiện ích tiếp theo:</i>\n` +
      `• Kiểm tra hiệu năng: <code>/perf ${dep.name}</code>\n` +
      `• Xem danh sách web: <code>/web_list</code>\n` +
      `• Gỡ bỏ web khi xong: <code>/web_remove ${dep.name}</code>`
    );
  } catch (err) {
    console.error('[DEPLOY_ZIP_EXECUTION_ERROR]', err);
    await ctx.replyWithHTML(`❌ <b>Lỗi khi deploy:</b> ${escapeHtml(err.message || String(err))}`);
  }
}

async function handleGitDeploy(ctx, deployId, target, config, nodeId = 'gcp-master') {
  try {
    const pending = deployStore.getPending(deployId);
    if (!pending) {
      await ctx.replyWithHTML('⚠️ <i>Yêu cầu deploy đã hết hạn hoặc không tồn tại. Vui lòng dán lại link GitHub.</i>');
      return;
    }

    if (target === 'both') {
      const feSub = pending.subdomain;
      const beSub = `api-${pending.subdomain}`;
      const baseDomain = config.baseDomain || 'thienhn.io.vn';

      await ctx.replyWithHTML(
        `⚙️ <b>Đang triển khai Monorepo "${escapeHtml(pending.projectName)}"...</b>\n` +
        `• Frontend: Vercel (<code>https://${escapeHtml(feSub)}.${baseDomain}</code>)\n` +
        `• Backend: Render (<code>https://${escapeHtml(beSub)}.${baseDomain}</code>)\n` +
        `<i>Đang tạo dịch vụ và cấu hình DNS Cloudflare...</i>`
      );

      const feRes = await deployer.deploy(
        {
          source: 'github_public',
          repoUrl: pending.repoUrl,
          projectName: pending.projectName,
          target: 'vercel',
          subdomain: feSub,
        },
        config
      );

      const beRes = await deployer.deploy(
        {
          source: 'github_public',
          repoUrl: pending.repoUrl,
          projectName: `api-${pending.projectName}`,
          target: 'render',
          subdomain: beSub,
        },
        config
      );

      deployStore.deletePending(deployId);

      await ctx.replyWithHTML(
        `🎉 <b>DEPLOY MONOREPO THÀNH CÔNG!</b>\n\n` +
        `• Frontend (Vercel): <a href="${feRes.deployment.url}">${feRes.deployment.url}</a>\n` +
        `• Backend (Render): <a href="${beRes.deployment.url}">${beRes.deployment.url}</a>\n\n` +
        `<i>Cả 2 dịch vụ đã online và được cấp SSL đầy đủ!</i>`
      );
      return;
    }

    await ctx.replyWithHTML(
      `⚙️ <b>Đang triển khai kho lưu trữ GitHub "${escapeHtml(pending.projectName)}"...</b>\n` +
      `• Nền tảng: <b>${escapeHtml(target.toUpperCase())}</b>\n` +
      `• Repo: <code>${escapeHtml(pending.repoUrl)}</code>\n` +
      `<i>Đang tạo service và kết nối tên miền...</i>`
    );

    const result = await deployer.deploy(
      {
        source: 'github_public',
        repoUrl: pending.repoUrl,
        projectName: pending.projectName,
        target,
        subdomain: pending.subdomain,
        nodeId: target === 'vps' ? nodeId : undefined,
      },
      config
    );

    deployStore.deletePending(deployId);
    const dep = result.deployment;

    await ctx.replyWithHTML(
      `🎉 <b>DEPLOY GITHUB THÀNH CÔNG!</b>\n\n` +
      `• Dự án: <b>${escapeHtml(dep.name)}</b>\n` +
      `• Nền tảng: <code>${dep.target.toUpperCase()}</code>\n` +
      `• Nguồn: <code>${escapeHtml(dep.sourceDetail || pending.repoUrl)}</code>\n` +
      `• Tên miền: <code>${escapeHtml(dep.domain)}</code>\n` +
      `• URL truy cập: <a href="${dep.url}">${dep.url}</a>\n\n` +
      `<i>Tiện ích tiếp theo:</i>\n` +
      `• Xem danh sách web: <code>/web_list</code>\n` +
      `• Gỡ bỏ web khi xong: <code>/web_remove ${dep.name}</code>`
    );
  } catch (err) {
    console.error('[DEPLOY_GIT_EXECUTION_ERROR]', err);
    await ctx.replyWithHTML(`❌ <b>Lỗi khi deploy lên ${escapeHtml(target.toUpperCase())}:</b> ${escapeHtml(err.message || String(err))}`);
  }
}

module.exports = {
  name: 'deploy',
  description: 'Deploy web cá nhân với 1 chạm (hỗ trợ chọn ZIP hoặc dán link GitHub)',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /deploy</b>\n` +
          `Triển khai ZIP lên VPS qua Nginx HTTPS và subdomain riêng. Vercel/Render tạm ẩn cho đến khi kiểm chứng web chạy thật.\n\n` +
          `<b>Cách 1 (Bấm nút trên Telegram):</b> Gõ <code>/deploy</code> để chọn file .zip sẵn có.\n` +
          `<b>Cách 2 (Gõ lệnh trực tiếp):</b> <code>/deploy &lt;file.zip&gt;</code>\n\n` +
          `<b>Ví dụ:</b> <code>/deploy my-portfolio.zip vps</code>`
        );
        return;
      }

      if (args.length > 0) {
        const zipArg = args[0].endsWith('.zip') ? args[0] : `${args[0]}.zip`;
        const targetArg = (args[1] || 'vps').toLowerCase();
        const nodeIdArg = args[2] || undefined;
        await handleZipDeploy(ctx, zipArg, targetArg, config, { nodeId: nodeIdArg });
        return;
      }

      const zips = await sandbox.listUploadZipFiles(config.uploadDir);

      if (!zips.length) {
        await ctx.replyWithHTML(
          `📦 <b>Không tìm thấy file .zip nào trong thư mục upload!</b>\n\n` +
          `• Thư mục upload: <code>${escapeHtml(config.uploadDir)}</code>\n\n` +
          `<i>Bạn có thể upload file .zip qua scp/sftp hoặc gửi trực tiếp link GitHub công khai để deploy ngay!</i>`
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
        `<i>Bấm vào file bạn muốn triển khai:</i>`,
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
    // 1. Khi chọn file ZIP: hỏi nền tảng nếu có nhiều hơn 1 lựa chọn hoặc nhiều VPS node
    bot.action(/^deploy_zip:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const zipName = ctx.match[1];
        const depNodeManager = config?.nodeManager || nodeManager;
        const nodes = await depNodeManager.getNodes(config);
        const validTargets = deployer.getValidTargetsForSource('zip_upload', config);

        if (validTargets.length > 1 || (validTargets.includes('vps') && nodes.length > 1)) {
          const buttons = [];
          if (validTargets.includes('vps')) {
            if (nodes.length > 1) {
              for (const node of nodes) {
                buttons.push([{
                  text: `🖥️ VPS: ${node.name || node.id}`,
                  callback_data: `zip_target:vps:${node.id}:${zipName}`,
                }]);
              }
            } else {
              buttons.push([{
                text: '🖥️ Triển khai lên VPS (Nginx)',
                callback_data: `zip_target:vps:${nodes[0]?.id || 'gcp-master'}:${zipName}`,
              }]);
            }
          }
          if (validTargets.includes('vercel')) {
            buttons.push([{ text: '▲ Triển khai lên Vercel', callback_data: `zip_target:vercel:${zipName}` }]);
          }

          await ctx.replyWithHTML(
            `📦 <b>Đã chọn file:</b> <code>${escapeHtml(zipName)}</code>\n\n` +
            `<b>Chọn nền tảng triển khai:</b>`,
            {
              reply_markup: {
                inline_keyboard: buttons,
              },
            }
          );
          return;
        }

        // Nếu chỉ có VPS và 1 node duy nhất
        await handleZipDeploy(ctx, zipName, 'vps', config, { nodeId: nodes[0]?.id });
      } catch (err) {
        console.error('[DEPLOY_ZIP_ACTION_ERROR]', err);
        await ctx.reply('⚠️ Lỗi khi chọn file deploy.');
      }
    });

    // 2. Khi xác nhận nền tảng cho file ZIP
    bot.action(/^zip_target:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('Bắt đầu triển khai...');
        const payload = ctx.match[1];
        const parts = payload.split(':');
        let target = 'vps';
        let nodeId = undefined;
        let zipName = '';

        if (parts[0] === 'vps') {
          target = 'vps';
          if (parts.length >= 3) {
            nodeId = parts[1];
            zipName = parts.slice(2).join(':');
          } else {
            zipName = parts[1];
          }
        } else {
          target = parts[0];
          zipName = parts.slice(1).join(':');
        }

        await handleZipDeploy(ctx, zipName, target, config, { nodeId });
      } catch (err) {
        console.error('[ZIP_TARGET_ACTION_ERROR]', err);
        await ctx.reply('⚠️ Lỗi khi kích hoạt deploy file zip.');
      }
    });

    // 3. Khi xác nhận nền tảng cho GitHub Link
    bot.action(/^git_target:([a-zA-Z0-9]+):([a-zA-Z0-9_-]+)(?::([a-zA-Z0-9_-]+))?$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('Bắt đầu triển khai GitHub...');
        const deployId = ctx.match[1];
        const target = ctx.match[2];
        const nodeId = ctx.match[3] || 'gcp-master';
        await handleGitDeploy(ctx, deployId, target, config, nodeId);
      } catch (err) {
        console.error('[GIT_TARGET_ACTION_ERROR]', err);
        await ctx.reply('⚠️ Lỗi khi kích hoạt deploy từ GitHub.');
      }
    });

    // 4. Khi người dùng bấm đổi Subdomain cho GitHub Deploy
    bot.action(/^git_rename:([a-zA-Z0-9]+)$/, async (ctx) => {
      try {
        const deployId = ctx.match[1];
        const pending = deployStore.getPending(deployId);
        if (!pending) {
          await ctx.answerCbQuery('Yêu cầu đã hết hạn!');
          await ctx.reply('⚠️ Yêu cầu deploy đã hết hạn. Vui lòng dán lại link GitHub.');
          return;
        }

        deployStore.setAwaitingSubdomain(ctx.from?.id, deployId);
        await ctx.answerCbQuery();
        await ctx.replyWithHTML(
          `✏️ <b>ĐỔI SUBDOMAIN CHO DỰ ÁN</b>\n\n` +
          `• Dự án: <b>${escapeHtml(pending.projectName)}</b>\n` +
          `• Subdomain hiện tại: <code>${escapeHtml(pending.subdomain)}</code>\n\n` +
          `<i>Vui lòng nhập tên subdomain mới bạn muốn sử dụng (ví dụ: <code>my-cool-app</code>):</i>`
        );
      } catch (err) {
        console.error('[GIT_RENAME_ACTION_ERROR]', err);
      }
    });

    // 5. Khi người dùng bấm Hủy
    bot.action(/^git_cancel:([a-zA-Z0-9]+)$/, async (ctx) => {
      try {
        const deployId = ctx.match[1];
        deployStore.deletePending(deployId);
        if (ctx.from?.id) {
          deployStore.clearAwaitingSubdomain(ctx.from.id);
        }
        await ctx.answerCbQuery('Đã hủy yêu cầu deploy.');
        await ctx.editMessageText('❌ Đã hủy yêu cầu triển khai GitHub.').catch(() => {});
      } catch (err) {
        console.error('[GIT_CANCEL_ACTION_ERROR]', err);
      }
    });
  },
};
