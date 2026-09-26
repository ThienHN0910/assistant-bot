const { escapeHtml } = require('../config/utils');
const whitelist = require('../lib/whitelist');
const runner = require('../lib/runner');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

function buildStepOutput(step, res) {
  const parts = [];
  parts.push(`Lệnh: ${step.cmd} ${(step.args || []).join(' ')}`.trim());
  parts.push(`Trạng thái: ${res.ok ? 'Thành công' : 'Thất bại'}`);
  if (res.stdout) {
    parts.push('');
    parts.push('stdout:');
    parts.push(res.stdout.trimEnd());
  }
  if (res.stderr) {
    parts.push('');
    parts.push('stderr:');
    parts.push(res.stderr.trimEnd());
  }
  if (typeof res.code !== 'undefined') {
    parts.push('');
    parts.push(`exit code: ${res.code}`);
  }
  return parts.join('\n');
}

const DEFAULT_UPDATE_STEPS = [
  { cmd: 'git', args: ['pull', 'origin', 'main'] },
  { cmd: 'npm', args: ['install', '--omit=dev'] },
];

async function runLocalUpdate(ctx, config = {}, deps = {}) {
  const depWhitelist = deps.whitelist || whitelist;
  const depRunner = deps.runner || runner;

  let commands;
  try {
    commands = depWhitelist.getCommands('update', []);
  } catch {
    commands = DEFAULT_UPDATE_STEPS;
  }

  await ctx.replyWithHTML('🚀 <b>Bắt đầu quá trình Cập nhật Bot tự động...</b>\n<i>Vui lòng đợi (quá trình có thể mất từ vài chục giây đến 1 phút)...</i>');

  const results = await depRunner.runSequence(commands, { timeoutMs: 90000 });

  const blocks = [];
  for (let i = 0; i < commands.length; i++) {
    const step = commands[i];
    const res = results[i] || { ok: false, stdout: '', stderr: 'Không có kết quả', code: null };
    blocks.push(buildStepOutput(step, res));
  }

  const output = blocks.join('\n\n-----\n\n');
  const escaped = escapeHtml(output);

  // Gửi kết quả
  let success = true;
  for (const res of results) {
    if (!res.ok) success = false;
  }

  try {
    if (escaped.length <= 3500) {
      await ctx.replyWithHTML(`✅ <b>Hoàn thành Cập nhật! Kết quả chi tiết:</b>\n<pre>${escaped}</pre>`);
    } else {
      await ctx.replyWithHTML('✅ <b>Hoàn thành Cập nhật!</b> Kết quả quá dài, gửi dưới dạng file đính kèm.');
      const buffer = Buffer.from(output, 'utf8');
      await ctx.replyWithDocument({ source: buffer, filename: 'update-output.txt' });
    }

    if (success) {
      await ctx.replyWithHTML('🔄 <b>Đang khởi động lại Bot để áp dụng thay đổi...</b>\n<i>Tiến trình sẽ hoạt động trở lại sau vài giây.</i>');

      const restartDelay = typeof deps.restartDelay === 'number' ? deps.restartDelay : 1500;
      setTimeout(() => {
        const execFn = deps.exec || require('child_process').exec;
        const processName = process.env.PM2_PROCESS_NAME || config?.pm2ProcessName || 'assistant-bot';
        execFn(`pm2 restart ${processName} --update-env --max-memory-restart 200M`, (err) => {
          if (err) console.error('[PM2_RESTART_ERROR]', err);
        });
      }, restartDelay);
    }
  } catch (sendErr) {
    console.error('[UPDATE_REPLY_ERROR]', sendErr);
    const truncated = escaped.slice(0, 3500) + '\n\n... (đã rút gọn)';
    await ctx.replyWithHTML(`<pre>${truncated}</pre>`).catch(() => {});
  }
  return success;
}

async function runRemoteUpdate(ctx, node, depNodeClient) {
  await ctx.replyWithHTML(`🚀 <b>Bắt đầu cập nhật máy chủ [${escapeHtml(node.name || node.id)}]...</b>\n<i>Đang gửi lệnh cập nhật từ xa...</i>`);
  try {
    const res = await depNodeClient.update(node);
    if (res && res.ok) {
      const details = res.output ? `\n<pre>${escapeHtml(typeof res.output === 'string' ? res.output : JSON.stringify(res.output, null, 2))}</pre>` : '';
      await ctx.replyWithHTML(`✅ <b>Máy chủ [${escapeHtml(node.name || node.id)}] cập nhật thành công!</b>${details}`);
      return true;
    } else {
      await ctx.replyWithHTML(`❌ <b>Lỗi khi cập nhật máy chủ [${escapeHtml(node.name || node.id)}]:</b> ${escapeHtml(res?.error || 'Thất bại')}`);
      return false;
    }
  } catch (err) {
    await ctx.replyWithHTML(`❌ <b>Lỗi kết nối khi cập nhật máy chủ [${escapeHtml(node.name || node.id)}]:</b> ${escapeHtml(err.message)}`);
    return false;
  }
}

module.exports = {
  name: 'update',
  description: 'Tự động cập nhật mã nguồn bot và khởi động lại (git-pull, npm-install, pm2-restart)',
  DEFAULT_UPDATE_STEPS,
  execute: async (ctx, config = {}, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /update</b>\n` +
          `Tự động cập nhật mã nguồn bot từ GitHub, cài đặt các thư viện mới nếu có và khởi động lại tiến trình PM2 quản lý bot.\n\n` +
          `<b>Cú pháp:</b> <code>/update [all | &lt;node_id&gt;]</code>\n` +
          `<b>Ví dụ:</b>\n` +
          `• <code>/update</code> (cập nhật node hiện tại)\n` +
          `• <code>/update all</code> (cập nhật tất cả các node trong cụm)\n` +
          `• <code>/update oracle-worker</code> (cập nhật riêng worker)`
        );
        return;
      }

      const depNodeManager = deps.nodeManager || config.nodeManager || nodeManager;
      const depNodeClient = deps.nodeClient || config.nodeClient || nodeClient;

      const target = args[0] ? args[0].toLowerCase() : null;

      // Không tham số hoặc tham số là local -> cập nhật local
      if (!target || target === 'local') {
        await runLocalUpdate(ctx, config, deps);
        return;
      }

      // Cập nhật tất cả các nodes
      if (target === 'all') {
        const nodes = await depNodeManager.getNodes(config);
        const remoteNodes = nodes.filter((n) => !n.isLocal);

        for (const rNode of remoteNodes) {
          await runRemoteUpdate(ctx, rNode, depNodeClient);
        }

        // Cập nhật local node sau cùng
        await runLocalUpdate(ctx, config, deps);
        return;
      }

      // Cập nhật một node cụ thể theo ID
      let node = null;
      if (typeof depNodeManager.getNode === 'function') {
        node = await depNodeManager.getNode(target, config);
      }
      if (!node) {
        const allNodes = await depNodeManager.getNodes(config);
        node = allNodes.find((n) => n.id.toLowerCase() === target);
      }

      if (!node) {
        await ctx.replyWithHTML(`⚠️ Không tìm thấy máy chủ với mã: <code>${escapeHtml(args[0])}</code>.`);
        return;
      }

      if (node.isLocal) {
        await runLocalUpdate(ctx, config, deps);
      } else {
        await runRemoteUpdate(ctx, node, depNodeClient);
      }
    } catch (error) {
      console.error('[UPDATE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh cập nhật lúc này.');
    }
  },
};
