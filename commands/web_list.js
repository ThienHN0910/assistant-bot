const deployer = require('../lib/deployer');
const nodeManager = require('../lib/nodeManager');
const { escapeHtml } = require('../config/utils');

function resolveServerLabel(deployment, nodes = []) {
  if (deployment.target === 'vercel') {
    return '▲ Vercel Cloud';
  }
  if (deployment.target === 'render') {
    return '⚡ Render Cloud';
  }
  if (deployment.target === 'vps') {
    const nodeId = deployment.nodeId || 'gcp-master';
    const found = nodes.find((n) => n.id === nodeId);
    if (found) {
      const icon = found.isLocal ? '🖥️' : '☁️';
      const role = found.isLocal ? 'Master' : 'Worker';
      return `${icon} ${found.name || found.id} (${role})`;
    }
    if (nodeId === 'oracle-worker') {
      return '☁️ Oracle Worker';
    }
    return `🖥️ VPS (${nodeId})`;
  }
  return '🖥️ VPS';
}

function buildWebListKeyboard(deployments) {
  if (!deployments || !deployments.length) return null;

  if (deployments.length <= 4) {
    const rows = [];
    for (const d of deployments) {
      rows.push([
        { text: `⚡ Đo: ${d.name}`, callback_data: `weblist_perf:${d.name}` },
        { text: `🗑️ Xóa: ${d.name}`, callback_data: `weblist_rm:${d.name}` },
      ]);
    }
    rows.push([
      { text: '🔄 Làm mới', callback_data: 'weblist_refresh' },
    ]);
    return { inline_keyboard: rows };
  }

  return {
    inline_keyboard: [
      [
        { text: '⚡ Đo tốc độ (Chọn web)', callback_data: 'weblist_menu_perf' },
        { text: '🗑️ Gỡ bỏ web (Chọn web)', callback_data: 'weblist_menu_rm' },
      ],
      [
        { text: '🔄 Làm mới', callback_data: 'weblist_refresh' },
      ],
    ],
  };
}

async function buildWebListMessage(config, deps = {}) {
  const depDeployer = deps.deployer || deployer;
  const depNodeManager = deps.nodeManager || nodeManager;

  const [deployments, nodes] = await Promise.all([
    depDeployer.listAllDeployments(config),
    depNodeManager.getNodes(config).catch(() => []),
  ]);

  if (!deployments.length) {
    return {
      text:
        `🌐 <b>CHƯA CÓ WEB NÀO ĐƯỢC TRIỂN KHAI</b>\n\n` +
        `<i>Hãy upload file .zip hoặc dán link GitHub công khai để triển khai web đầu tiên!</i>`,
      reply_markup: null,
      deployments: [],
    };
  }

  const lines = [];
  lines.push('🌐 <b>DANH SÁCH DỰ ÁN ĐANG CHẠY (VPS & CLOUD)</b>\n');

  deployments.forEach((d, idx) => {
    const url = d.url || (d.domain ? `https://${d.domain}` : 'N/A');
    const typeLabel = d.type === 'backend' ? 'Node.js Backend' : 'Web Tĩnh';
    const deployedDate = d.deployedAt ? new Date(d.deployedAt).toLocaleString('vi-VN') : 'N/A';
    const serverLabel = resolveServerLabel(d, nodes);

    lines.push(
      `<b>${idx + 1}. ${escapeHtml(d.name)}</b> [<code>${typeLabel}</code>]\n` +
      `   • Máy chủ: <b>${escapeHtml(serverLabel)}</b>\n` +
      `   • URL: ${url === 'N/A' ? 'N/A' : `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`}\n` +
      `   • Trạng thái: <code>${escapeHtml(d.status || 'unknown')}</code> | Dung lượng: <b>${d.sizeFormatted || 'N/A'}</b>\n` +
      `   • Deploy: <i>${deployedDate}</i>\n` +
      `   • Thao tác nhanh: <code>/perf ${d.name}</code> | <code>/web_remove ${d.name}</code>`
    );
  });

  return {
    text: lines.join('\n\n'),
    reply_markup: buildWebListKeyboard(deployments),
    deployments,
  };
}

module.exports = {
  name: 'web_list',
  description: 'Xem danh sách các web đang chạy (VPS, Vercel, Render) kèm nút tương tác',
  resolveServerLabel,
  buildWebListKeyboard,
  buildWebListMessage,
  execute: async (ctx, config, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /web_list</b>\n` +
          `Liệt kê toàn bộ các dự án đang chạy trên cụm VPS (GCP, Oracle) và Cloud (Vercel, Render) kèm link tên miền và nút thao tác nhanh.\n\n` +
          `<b>Cú pháp:</b> <code>/web_list</code>\n` +
          `<b>Ví dụ:</b> <code>/web_list</code>`
        );
        return;
      }

      const { text: msgText, reply_markup } = await buildWebListMessage(config, deps);
      await ctx.replyWithHTML(msgText, reply_markup ? { reply_markup } : {});
    } catch (error) {
      console.error('[WEB_LIST_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy danh sách web lúc này.');
    }
  },

  register: (bot, config, deps = {}) => {
    const depDeployer = deps.deployer || deployer;

    // 1. Làm mới danh sách
    bot.action('weblist_refresh', async (ctx) => {
      try {
        await ctx.answerCbQuery('🔄 Đang làm mới danh sách...').catch(() => {});
        const { text, reply_markup } = await buildWebListMessage(config, deps);
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: reply_markup || undefined }).catch(() => {});
      } catch (err) {
        console.error('[WEBLIST_REFRESH_ERROR]', err);
      }
    });

    // 2. Đo tốc độ trực tiếp từ nút: weblist_perf:<name>
    bot.action(/^weblist_perf:(.+)$/, async (ctx) => {
      try {
        const projectName = ctx.match[1];
        await ctx.answerCbQuery(`⚡ Đang đo hiệu năng cho ${projectName}...`).catch(() => {});
        const perfCommand = require('./perf');
        const syntheticCtx = {
          ...ctx,
          message: { text: `/perf ${projectName}` },
          replyWithHTML: (t, o) => ctx.replyWithHTML(t, o),
        };
        await perfCommand.execute(syntheticCtx, config);
      } catch (err) {
        console.error('[WEBLIST_PERF_ACTION_ERROR]', err);
      }
    });

    // 3. Hỏi xác nhận gỡ bỏ web: weblist_rm:<name>
    bot.action(/^weblist_rm:(.+)$/, async (ctx) => {
      try {
        const projectName = ctx.match[1];
        await ctx.answerCbQuery().catch(() => {});
        const deployments = await depDeployer.listAllDeployments(config);
        const dep = deployments.find((d) => d.name === projectName);
        const targetLabel = dep?.target === 'vps'
          ? (dep?.nodeId === 'oracle-worker' ? 'Oracle Worker' : 'GCP Master')
          : (dep?.target?.toUpperCase() || 'VPS');

        await ctx.replyWithHTML(
          `⚠️ <b>XÁC NHẬN GỠ BỎ WEBSITE</b>\n\n` +
          `Bạn có chắc chắn muốn gỡ bỏ dự án <b>${escapeHtml(projectName)}</b> trên máy chủ <b>${escapeHtml(targetLabel)}</b> không?\n\n` +
          `<i>Hành động này sẽ xóa toàn bộ mã nguồn và thu hồi bản ghi DNS liên quan.</i>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: `✅ Xác nhận gỡ bỏ ${projectName}`, callback_data: `weblist_confirm_rm:${projectName}` },
                ],
                [
                  { text: '❌ Hủy bỏ', callback_data: 'weblist_cancel_rm' },
                ],
              ],
            },
          }
        );
      } catch (err) {
        console.error('[WEBLIST_RM_PROMPT_ERROR]', err);
      }
    });

    // 4. Người dùng xác nhận gỡ bỏ: weblist_confirm_rm:<name>
    bot.action(/^weblist_confirm_rm:(.+)$/, async (ctx) => {
      try {
        const projectName = ctx.match[1];
        await ctx.answerCbQuery('Đang gỡ bỏ dự án...').catch(() => {});
        await ctx.editMessageText(`⏳ <i>Đang gỡ bỏ dự án "${escapeHtml(projectName)}"...</i>`, { parse_mode: 'HTML' }).catch(() => {});
        const res = await depDeployer.undeploy(projectName, config);
        await ctx.editMessageText(
          `✅ <b>ĐÃ GỠ BỎ THÀNH CÔNG DỰ ÁN "${escapeHtml(res.name)}"!</b>\n\n` +
          `• Nền tảng: <code>${res.target.toUpperCase()}</code>\n` +
          `• Đã xóa virtual host & giải phóng tài nguyên.\n` +
          (res.dnsDeleted ? `• Đã xóa bản ghi DNS Cloudflare thành công.` : `• Không có bản ghi DNS thuộc bot cần xóa.`),
          { parse_mode: 'HTML' }
        ).catch(() => {});
      } catch (err) {
        console.error('[WEBLIST_CONFIRM_RM_ERROR]', err);
        await ctx.editMessageText(`❌ <b>Lỗi khi gỡ bỏ web:</b> ${escapeHtml(err.message || String(err))}`, { parse_mode: 'HTML' }).catch(() => {});
      }
    });

    // 5. Hủy gỡ bỏ
    bot.action('weblist_cancel_rm', async (ctx) => {
      try {
        await ctx.answerCbQuery('Đã hủy thao tác gỡ bỏ.').catch(() => {});
        await ctx.editMessageText('❌ <i>Đã hủy thao tác gỡ bỏ web. Dự án vẫn hoạt động bình thường.</i>', { parse_mode: 'HTML' }).catch(() => {});
      } catch (err) {
        console.error('[WEBLIST_CANCEL_RM_ERROR]', err);
      }
    });

    // 6. Menu chọn web để đo tốc độ (khi danh sách > 4 web)
    bot.action('weblist_menu_perf', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const deployments = await depDeployer.listAllDeployments(config);
        if (!deployments.length) {
          await ctx.replyWithHTML('ℹ️ Hiện không có website nào đang hoạt động.');
          return;
        }
        const buttons = [];
        for (let i = 0; i < deployments.length; i += 2) {
          const row = [];
          row.push({ text: `⚡ ${deployments[i].name}`, callback_data: `weblist_perf:${deployments[i].name}` });
          if (deployments[i + 1]) {
            row.push({ text: `⚡ ${deployments[i + 1].name}`, callback_data: `weblist_perf:${deployments[i + 1].name}` });
          }
          buttons.push(row);
        }
        buttons.push([{ text: '🔙 Quay lại danh sách', callback_data: 'weblist_refresh' }]);
        await ctx.replyWithHTML('⚡ <b>Chọn website bạn muốn đo lường hiệu năng:</b>', {
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (err) {
        console.error('[WEBLIST_MENU_PERF_ERROR]', err);
      }
    });

    // 7. Menu chọn web để gỡ bỏ (khi danh sách > 4 web)
    bot.action('weblist_menu_rm', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const deployments = await depDeployer.listAllDeployments(config);
        if (!deployments.length) {
          await ctx.replyWithHTML('ℹ️ Hiện không có website nào đang hoạt động.');
          return;
        }
        const buttons = [];
        for (let i = 0; i < deployments.length; i += 2) {
          const row = [];
          row.push({ text: `🗑️ ${deployments[i].name}`, callback_data: `weblist_rm:${deployments[i].name}` });
          if (deployments[i + 1]) {
            row.push({ text: `🗑️ ${deployments[i + 1].name}`, callback_data: `weblist_rm:${deployments[i + 1].name}` });
          }
          buttons.push(row);
        }
        buttons.push([{ text: '🔙 Quay lại danh sách', callback_data: 'weblist_refresh' }]);
        await ctx.replyWithHTML('🗑️ <b>Chọn website bạn muốn gỡ bỏ khỏi hệ thống:</b>', {
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (err) {
        console.error('[WEBLIST_MENU_RM_ERROR]', err);
      }
    });
  },
};
