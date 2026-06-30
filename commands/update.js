const { escapeHtml } = require('../config/utils');
const whitelist = require('../lib/whitelist');
const runner = require('../lib/runner');

function buildStepOutput(step, res) {
  const parts = [];
  parts.push(`Lệnh: ${step.cmd} ${ (step.args || []).join(' ') }`.trim());
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

module.exports = {
  name: 'update',
  description: 'Tự động cập nhật mã nguồn bot và khởi động lại (git-pull, npm-install, npm-build, pm2-restart)',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /update</b>\n` +
          `Tự động cập nhật mã nguồn bot từ GitHub, cài đặt các thư viện mới nếu có, biên dịch dự án và khởi động lại tiến trình PM2 quản lý bot.\n\n` +
          `<b>Cú pháp:</b> <code>/update</code>\n` +
          `<b>Ví dụ:</b> <code>/update</code>`
        );
        return;
      }

      let commands;
      try {
        commands = whitelist.getCommands('update', []);
      } catch (err) {
        await ctx.replyWithHTML(`🚫 Lỗi cấu hình whitelist: ${escapeHtml(String(err.message || err))}`);
        return;
      }

      await ctx.replyWithHTML('🚀 <b>Bắt đầu quá trình Cập nhật Bot tự động...</b>\n<i>Vui lòng đợi (quá trình có thể mất từ vài chục giây đến 1 phút)...</i>');

      const results = await runner.runSequence(commands, { timeoutMs: 90000 });

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
          await ctx.replyWithDocument({ source: buffer, filename: `update-output.txt` });
        }

        if (success) {
          await ctx.replyWithHTML(`🔄 <b>Đang khởi động lại Bot để áp dụng thay đổi...</b>\n<i>Tiến trình sẽ hoạt động trở lại sau vài giây.</i>`);
          
          setTimeout(() => {
            const { exec } = require('child_process');
            const processName = process.env.PM2_PROCESS_NAME || 'assistant-bot';
            exec(`pm2 restart ${processName}`, (err) => {
              if (err) console.error('[PM2_RESTART_ERROR]', err);
            });
          }, 1500);
        }
      } catch (sendErr) {
        console.error('[UPDATE_REPLY_ERROR]', sendErr);
        const truncated = escaped.slice(0, 3500) + '\n\n... (đã rút gọn)';
        await ctx.replyWithHTML(`<pre>${truncated}</pre>`).catch(() => {});
      }
    } catch (error) {
      console.error('[UPDATE_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh cập nhật lúc này.');
    }
  },
};
