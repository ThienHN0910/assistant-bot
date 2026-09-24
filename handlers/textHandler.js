const fs = require('fs/promises');
const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');
const deployStore = require('../lib/deployStore');

const GITHUB_REPO_REGEX = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/)?/i;

function buildGitDeployMessage(repoUrl, projectName, subdomain, baseDomain, validTargets, deployId) {
  const expectedDomain = `${subdomain}.${baseDomain}`;
  const buttons = [];
  const targetRow = [];

  if (validTargets.includes('vercel')) {
    targetRow.push({ text: `▲ Vercel (${subdomain})`, callback_data: `git_target:${deployId}:vercel` });
  }
  if (validTargets.includes('render')) {
    targetRow.push({ text: `🔷 Render (${subdomain})`, callback_data: `git_target:${deployId}:render` });
  }
  if (targetRow.length > 0) {
    buttons.push(targetRow);
  }

  buttons.push([
    { text: '✏️ Đổi Subdomain', callback_data: `git_rename:${deployId}` },
    { text: '❌ Hủy', callback_data: `git_cancel:${deployId}` },
  ]);

  const html =
    `🐙 <b>PHÁT HIỆN KHO LƯU TRỮ GITHUB</b>\n\n` +
    `• Repo: <code>${escapeHtml(repoUrl)}</code>\n` +
    `• Dự án: <b>${escapeHtml(projectName)}</b>\n` +
    `• Tên miền đề xuất: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
    `<i>⚠️ Mã nguồn GitHub công khai sẽ được deploy lên Vercel hoặc Render (không deploy lên VPS để tiết kiệm RAM).</i>\n\n` +
    `<b>Bấm 1-chạm để triển khai ngay hoặc tùy chỉnh subdomain:</b>`;

  return { html, buttons };
}

function createTextHandler(config) {
  return async (ctx) => {
    try {
      const text = ctx.message?.text;

      // Chỉ xử lý text thường, bỏ qua lệnh bắt đầu bằng '/'.
      if (!text || text.startsWith('/')) {
        return;
      }

      const userId = ctx.from?.id;

      // 1. Kiểm tra xem người dùng có đang trong trạng thái đổi Subdomain không
      const awaitingDeployId = deployStore.getAwaitingSubdomain(userId);
      if (awaitingDeployId) {
        const pending = deployStore.getPending(awaitingDeployId);
        if (!pending) {
          deployStore.clearAwaitingSubdomain(userId);
          await ctx.reply('⚠️ Yêu cầu deploy đã hết hạn. Vui lòng dán lại link GitHub.');
          return;
        }

        const customInput = text.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!customInput) {
          await ctx.reply('⚠️ Subdomain không hợp lệ. Vui lòng chỉ dùng chữ cái, số hoặc dấu gạch nối (ví dụ: my-app):');
          return;
        }

        const resolvedSub = await deployer.resolveAvailableSubdomain(customInput, config);
        pending.subdomain = resolvedSub;
        deployStore.clearAwaitingSubdomain(userId);

        const baseDomain = config.baseDomain || 'thienhn.io.vn';
        const validTargets = deployer.getValidTargetsForSource('github_public', config);
        const { html, buttons } = buildGitDeployMessage(
          pending.repoUrl,
          pending.projectName,
          resolvedSub,
          baseDomain,
          validTargets,
          awaitingDeployId
        );

        await ctx.replyWithHTML(`✅ <b>Đã cập nhật tên miền thành công!</b>\n\n${html}`, {
          reply_markup: { inline_keyboard: buttons },
        });
        return;
      }

      // 2. Nhận diện link GitHub Repository công khai
      const gitMatch = text.trim().match(GITHUB_REPO_REGEX);
      if (gitMatch) {
        const repoUrl = `https://github.com/${gitMatch[1]}/${gitMatch[2].replace(/\.git$/, '')}`;
        const owner = gitMatch[1];
        const repoName = gitMatch[2].replace(/\.git$/, '');
        const projectName = repoName.toLowerCase();
        const baseDomain = config.baseDomain || 'thienhn.io.vn';

        const validTargets = deployer.getValidTargetsForSource('github_public', config);

        if (validTargets.length === 0) {
          await ctx.replyWithHTML(
            `🐙 <b>Phát hiện kho lưu trữ GitHub:</b>\n` +
            `• Link: <code>${escapeHtml(repoUrl)}</code>\n` +
            `• Dự án: <b>${escapeHtml(projectName)}</b>\n\n` +
            `⚠️ <i>Hiện chưa thể deploy vì bạn chưa cấu hình <code>VERCEL_TOKEN</code> hoặc <code>RENDER_API_KEY</code> trong .env.</i>\n` +
            `<i>(Lưu ý: Kho lưu trữ GitHub công khai không được phép deploy trực tiếp lên VPS để đảm bảo an toàn).</i>`
          );
          return;
        }

        // Tự động phân giải subdomain với cơ chế kiểm tra trùng lặp (nếu trùng thêm 0, 1, 2...)
        const autoSubdomain = await deployer.resolveAvailableSubdomain(projectName, config);

        const deployId = Math.random().toString(36).substring(2, 9);
        deployStore.setPending(deployId, {
          source: 'github_public',
          repoUrl,
          projectName,
          subdomain: autoSubdomain,
        });

        const { html, buttons } = buildGitDeployMessage(
          repoUrl,
          projectName,
          autoSubdomain,
          baseDomain,
          validTargets,
          deployId
        );

        await ctx.replyWithHTML(html, {
          reply_markup: {
            inline_keyboard: buttons,
          },
        });
        return;
      }

      // 3. Text ghi chú cá nhân thông thường
      const timestamp = new Date().toLocaleString('vi-VN', {
        timeZone: config.timezone,
        hour12: false,
      });

      const line = `[${timestamp}] ${text}\n`;
      await fs.appendFile(config.notesFilePath, line, 'utf8');

      await ctx.reply('✅ Đã lưu ghi chú thành công!');
    } catch (error) {
      console.error('[TEXT_HANDLER_ERROR]', error);
      await ctx.reply('⚠️ Không thể xử lý tin nhắn vào lúc này.');
    }
  };
}

module.exports = { createTextHandler, GITHUB_REPO_REGEX };
