const fs = require('fs/promises');
const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');
const deployStore = require('../lib/deployStore');

const repoInspector = require('../lib/repoInspector');
const nodeManager = require('../lib/nodeManager');

const GITHUB_REPO_REGEX = /https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/)?/i;

function buildGitDeployMessage(repoUrl, projectName, subdomain, baseDomain, validTargets, deployId, inspection = null, vpsNodes = []) {
  const expectedDomain = `${subdomain}.${baseDomain}`;
  const buttons = [];

  if (inspection?.type === 'monorepo') {
    const feTarget = inspection.frontend?.target || 'vercel';
    const beTarget = inspection.backend?.target || 'render';
    const targetRow = [];
    if (validTargets.includes(feTarget)) {
      targetRow.push({ text: `▲ Frontend -> Vercel (${subdomain})`, callback_data: `git_target:${deployId}:${feTarget}` });
    }
    if (validTargets.includes(beTarget)) {
      targetRow.push({ text: `🔷 Backend -> Render (api-${subdomain})`, callback_data: `git_target:${deployId}:${beTarget}` });
    }
    if (targetRow.length > 0) buttons.push(targetRow);
    if (validTargets.includes('both') || (validTargets.includes(feTarget) && validTargets.includes(beTarget))) {
      buttons.push([{ text: `🚀 Deploy Cả Hai (FE + BE)`, callback_data: `git_target:${deployId}:both` }]);
    }
  } else {
    const targetRow = [];
    if (validTargets.includes('vps')) {
      for (const node of vpsNodes) {
        buttons.push([{ text: `🖥️ VPS ${node.name || node.id}`, callback_data: `git_target:${deployId}:vps:${node.id}` }]);
      }
    }
    if (validTargets.includes('vercel')) {
      targetRow.push({ text: `▲ Vercel (${subdomain})`, callback_data: `git_target:${deployId}:vercel` });
    }
    if (validTargets.includes('render')) {
      targetRow.push({ text: `🔷 Render (${subdomain})`, callback_data: `git_target:${deployId}:render` });
    }
    if (targetRow.length > 0) buttons.push(targetRow);
  }

  buttons.push([
    { text: '✏️ Đổi Subdomain', callback_data: `git_rename:${deployId}` },
    { text: '❌ Hủy', callback_data: `git_cancel:${deployId}` },
  ]);

  let typeDescription = '';
  if (inspection?.type === 'monorepo') {
    typeDescription =
      `• Cấu trúc: <b>📦 Monorepo</b>\n` +
      `  ├─ Frontend (${inspection.frontend.dir}): ${escapeHtml(inspection.frontend.frameworks.join(', '))}\n` +
      `  └─ Backend (${inspection.backend.dir}): ${escapeHtml(inspection.backend.frameworks.join(', '))}\n\n` +
      `• Tên miền FE: <code>https://${escapeHtml(expectedDomain)}</code>\n` +
      `• Tên miền BE: <code>https://api-${escapeHtml(expectedDomain)}</code>\n\n` +
      `<i>💡 Tự động phân tách: Frontend chạy trên Vercel, Backend chạy trên Render.</i>\n\n`;
  } else if (inspection?.type === 'static_pure') {
    typeDescription =
      `• Loại hình: <b>📄 Web tĩnh thuần (HTML/CSS/JS)</b>\n` +
      `• Tên miền đề xuất: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
      `<i>💡 Dự án không cần build, hỗ trợ deploy trực tiếp lên VPS hoặc Vercel.</i>\n\n`;
  } else if (inspection?.type === 'frontend_spa') {
    typeDescription =
      `• Công nghệ: <b>⚛️ ${escapeHtml(inspection.frameworks.join(', '))}</b>\n` +
      `• Tên miền đề xuất: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
      `<i>☁️ Dự án Frontend sẽ được build và host trên Vercel (bảo toàn RAM cho VPS).</i>\n\n`;
  } else if (inspection?.type === 'backend_api') {
    typeDescription =
      `• Công nghệ: <b>🔷 ${escapeHtml(inspection.frameworks.join(', '))}</b>\n` +
      `• Tên miền đề xuất: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
      `<i>☁️ Dịch vụ Backend sẽ được triển khai trên Render.</i>\n\n`;
  } else {
    typeDescription =
      `• Tên miền đề xuất: <code>https://${escapeHtml(expectedDomain)}</code>\n\n` +
      `<i>⚠️ Mã nguồn GitHub công khai sẽ được deploy lên Vercel hoặc Render (không deploy lên VPS để tiết kiệm RAM).</i>\n\n`;
  }

  const headerTitle = inspection?.type === 'monorepo'
    ? `🐙 <b>PHÁT HIỆN KHO LƯU TRỮ GITHUB (MONOREPO)</b>\n\n`
    : `🐙 <b>PHÁT HIỆN KHO LƯU TRỮ GITHUB</b>\n\n`;

  const html =
    headerTitle +
    `• Repo: <code>${escapeHtml(repoUrl)}</code>\n` +
    `• Dự án: <b>${escapeHtml(projectName)}</b>\n` +
    typeDescription +
    `<b>Bấm 1-chạm để triển khai ngay hoặc tùy chỉnh subdomain:</b>`;

  return { html, buttons };
}

function createTextHandler(config, deps = {}) {
  const depNM = deps.nodeManager || nodeManager;
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
        const repoType = pending.inspection?.type || null;
        const validTargets = deployer.getValidTargetsForSource('github_public', config, repoType);
        const vpsNodes = validTargets.includes('vps') ? await depNM.getNodes(config) : [];
        const { html, buttons } = buildGitDeployMessage(
          pending.repoUrl,
          pending.projectName,
          resolvedSub,
          baseDomain,
          validTargets,
          awaitingDeployId,
          pending.inspection,
          vpsNodes
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

        const depInspector = deps.inspector || repoInspector;
        let inspection = null;
        try {
          inspection = await depInspector.inspectRepo(repoUrl, { client: deps.client });
        } catch {}

        const repoType = inspection?.type || null;
        let validTargets = deployer.getValidTargetsForSource('github_public', config, repoType);
        const vpsNodes = validTargets.includes('vps') ? await depNM.getNodes(config) : [];
        if (inspection?.type === 'monorepo' && validTargets.includes('vercel') && validTargets.includes('render')) {
          validTargets.push('both');
        }

        if (validTargets.length === 0) {
          await ctx.replyWithHTML(
            `🐙 <b>Phát hiện kho lưu trữ GitHub:</b>\n` +
            `• Link: <code>${escapeHtml(repoUrl)}</code>\n` +
            `• Dự án: <b>${escapeHtml(projectName)}</b>\n\n` +
            `⚠️ <i>Deploy GitHub lên Vercel/Render đang tạm ẩn cho đến khi kiểm chứng ứng dụng chạy thật (issue #36).</i>\n` +
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
          inspection,
        });

        const { html, buttons } = buildGitDeployMessage(
          repoUrl,
          projectName,
          autoSubdomain,
          baseDomain,
          validTargets,
          deployId,
          inspection,
          vpsNodes
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
