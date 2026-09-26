async function handlePerfAudit(req, res, { config, depResolveTargetUrl, depPerf, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const rawTarget = body.target || body.url || body.projectName;
    if (!rawTarget) {
      sendJson(res, 400, { ok: false, error: 'Thiếu thông tin target hoặc url' });
      return;
    }

    const targetUrl = await depResolveTargetUrl(rawTarget, config);
    if (!targetUrl) {
      sendJson(res, 400, { ok: false, error: 'Không tìm thấy URL hợp lệ để đo hiệu năng' });
      return;
    }

    const latency = await depPerf.measureHttpLatency(targetUrl);
    const apiKey = process.env.PAGESPEED_API_KEY || null;
    const pageSpeed = await depPerf.fetchPageSpeedScore(targetUrl, apiKey);

    sendJson(res, 200, {
      ok: true,
      result: {
        targetUrl,
        latency,
        pageSpeed,
      },
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handlePerfAudit,
};
