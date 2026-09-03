const axios = require('axios');
const sandbox = require('../lib/sandbox');
const perf = require('../lib/perf');
const { escapeHtml } = require('../config/utils');

async function getPublicIp() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    return res.data?.ip || 'localhost';
  } catch {
    return 'localhost';
  }
}

async function resolveTargetUrl(input, config) {
  if (!input) return null;
  const trimmed = input.trim();

  // 1. Nếu là URL đầy đủ
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  const publicIp = await getPublicIp();

  // 2. Nếu là số port (vd: 8081)
  if (/^\d+$/.test(trimmed)) {
    return `http://${publicIp}:${trimmed}`;
  }

  // 3. Nếu là tên dự án trong sandbox
  const deployments = await sandbox.listDeployments(config.webDeployDir);
  const found = deployments.find((d) => d.name.toLowerCase() === trimmed.toLowerCase());
  if (found && found.port) {
    return `http://${publicIp}:${found.port}`;
  }

  // Fallback mặc định
  return `http://${publicIp}:${trimmed}`;
}

module.exports = {
  name: 'perf',
  description: 'Đo lường hiệu năng trang web (TTFB, độ trễ HTTP và Google PageSpeed)',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (!args.length || args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /perf</b>\n` +
          `Đo độ trễ phản hồi tại chỗ (TTFB, DNS, Connect) và lấy điểm Google PageSpeed Insights cho trang web.\n\n` +
          `<b>Cú pháp:</b> <code>/perf &lt;tên_project | port | url&gt;</code>\n\n` +
          `<b>Ví dụ:</b>\n` +
          `• <code>/perf 8081</code> (Đo theo port test)\n` +
          `• <code>/perf my-portfolio</code> (Đo theo tên dự án sandbox)\n` +
          `• <code>/perf https://example.com</code> (Đo theo URL bất kỳ)`
        );
        return;
      }

      const rawTarget = args[0];
      const targetUrl = await resolveTargetUrl(rawTarget, config);

      if (!targetUrl) {
        await ctx.replyWithHTML('⚠️ Không tìm thấy URL hợp lệ để đo hiệu năng.');
        return;
      }

      await ctx.replyWithHTML(
        `⏱️ <b>Đang đo lường hiệu năng cho:</b>\n<code>${escapeHtml(targetUrl)}</code>\n` +
        `<i>Vui lòng đợi vài giây để hoàn tất kiểm tra...</i>`
      );

      // 1. Đo độ trễ HTTP tại chỗ
      let latencyResult;
      try {
        latencyResult = await perf.measureHttpLatency(targetUrl);
      } catch (latErr) {
        await ctx.replyWithHTML(`❌ <b>Không thể kết nối đến URL:</b> ${escapeHtml(latErr.message || String(latErr))}`);
        return;
      }

      // 2. Đo Google PageSpeed (nếu khả dụng)
      const apiKey = process.env.PAGESPEED_API_KEY || null;
      const pageSpeedResult = await perf.fetchPageSpeedScore(targetUrl, apiKey);

      // 3. Format báo cáo kết quả
      const lines = [];
      lines.push('⚡ <b>KẾT QUẢ ĐO HIỆU NĂNG WEBSITE</b>\n');
      lines.push(`🌐 <b>Mục tiêu:</b> <code>${escapeHtml(targetUrl)}</code>`);
      lines.push(`• Trạng thái HTTP: <b>${latencyResult.statusCode}</b>`);
      lines.push(`• Kích thước phản hồi: <b>${latencyResult.sizeFormatted}</b>\n`);

      lines.push('⏱️ <b>Độ trễ phản hồi máy chủ (Server Latency):</b>');
      lines.push(`• <b>TTFB (Time To First Byte):</b> <code>${latencyResult.ttfbMs} ms</code>`);
      lines.push(`• DNS Lookup: <code>${latencyResult.dnsMs} ms</code>`);
      lines.push(`• TCP Connect: <code>${latencyResult.connectMs} ms</code>`);
      lines.push(`• Tổng thời gian: <b>${latencyResult.totalMs} ms</b>\n`);

      lines.push('🎯 <b>Google PageSpeed / Lighthouse (Mobile):</b>');
      if (pageSpeedResult.ok) {
        const score = pageSpeedResult.score ?? 'N/A';
        const scoreIcon = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴';
        lines.push(`• Điểm Performance: ${scoreIcon} <b>${score} / 100</b>`);
        lines.push(`• FCP (First Contentful Paint): <code>${pageSpeedResult.fcp}</code>`);
        lines.push(`• LCP (Largest Contentful Paint): <code>${pageSpeedResult.lcp}</code>`);
        lines.push(`• TBT (Total Blocking Time): <code>${pageSpeedResult.tbt}</code>`);
        lines.push(`• CLS (Cumulative Layout Shift): <code>${pageSpeedResult.cls}</code>`);
      } else if (pageSpeedResult.skipped) {
        lines.push(`<i>(${escapeHtml(pageSpeedResult.reason)})</i>`);
      } else {
        lines.push(`<i>⚠️ Không lấy được điểm PageSpeed: ${escapeHtml(pageSpeedResult.reason || 'Lỗi kết nối')}</i>`);
      }

      await ctx.replyWithHTML(lines.join('\n'));
    } catch (error) {
      console.error('[PERF_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hoàn thành đo đạc hiệu năng lúc này.');
    }
  },
};
