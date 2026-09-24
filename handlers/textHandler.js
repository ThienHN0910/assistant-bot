const fs = require('fs/promises');
const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');
const deployStore = require('../lib/deployStore');

const GITHUB_REPO_REGEX = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/)?/i;

function createTextHandler(config) {
  return async (ctx) => {
    try {
      const text = ctx.message?.text;

      // Chỉ xử lý text thường, bỏ qua lệnh bắt đầu bằng '/'.
      if (!text || text.startsWith('/')) {
        return;
      }

      // 1. Nhận diện link GitHub Repository công khai
      const gitMatch = text.trim().match(GITHUB_REPO_REGEX);
      if (gitMatch) {
        const repoUrl = `https://github.com/${gitMatch[1]}/${gitMatch[2].replace(/\.git$/, '')}`;
        const owner = gitMatch[1];
        const repoName = gitMatch[2].replace(/\.git$/, '');
        const projectName = repoName.toLowerCase();
        const baseDomain = config.baseDomain || 'thienhn.io.vn';
        const expectedDomain = `${projectName}.${baseDomain}`;

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

        const deployId = Math.random().toString(36).substring(2, 9);
        deployStore.setPending(deployId, {
          source: 'github_public',
          repoUrl,
          projectName,
          subdomain: projectName,
        });

        const buttons = [];
        if (validTargets.includes('vercel')) {
          buttons.push([{ text: '▲ Triển khai lên Vercel', callback_data: `git_target:${deployId}:vercel` }]);
        }
        if (validTargets.includes('render')) {
          buttons.push([{ text: '🟣 Triển khai lên Render', callback_data: `git_target:${deployId}:render` }]);
        }

        await ctx.replyWithHTML(
          `🐙 <b>PHÁT HIỆN KHO LƯU TRỮ GITHUB</b>\n\n` +
          `• Repo: <code>${escapeHtml(repoUrl)}</code>\n` +
          `• Dự án: <b>${escapeHtml(projectName)}</b>\n` +
          `• Tên miền dự kiến: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
          `<i>⚠️ Theo chính sách an toàn, mã nguồn GitHub công khai sẽ được deploy lên Vercel hoặc Render (không deploy trực tiếp lên VPS).</i>\n\n` +
          `<b>Vui lòng chọn nền tảng bạn muốn triển khai:</b>`,
          {
            reply_markup: {
              inline_keyboard: buttons,
            },
          }
        );
        return;
      }

      // 2. Text ghi chú cá nhân thông thường
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
