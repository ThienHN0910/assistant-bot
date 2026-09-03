const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const { formatFileSize } = require('../config/utils');

const execAsync = promisify(exec);

async function measureWithCurl(targetUrl) {
  const formatStr = '%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{http_code}|%{size_download}';
  const cmd = `curl -s -L -o /dev/null -w "${formatStr}" "${targetUrl}"`;
  const { stdout } = await execAsync(cmd, { timeout: 15000 });
  const parts = stdout.trim().split('|');
  if (parts.length < 7) {
    throw new Error('Curl output format invalid');
  }

  const dnsSec = parseFloat(parts[0]) || 0;
  const connectSec = parseFloat(parts[1]) || 0;
  const startTransferSec = parseFloat(parts[3]) || 0;
  const totalSec = parseFloat(parts[4]) || 0;
  const statusCode = parseInt(parts[5], 10) || 0;
  const sizeBytes = parseInt(parts[6], 10) || 0;

  const ttfbMs = Math.round(startTransferSec * 1000);
  const totalMs = Math.round(totalSec * 1000);
  const dnsMs = Math.round(dnsSec * 1000);
  const connectMs = Math.max(0, Math.round((connectSec - dnsSec) * 1000));

  return {
    method: 'curl',
    statusCode,
    dnsMs,
    connectMs,
    ttfbMs,
    totalMs,
    sizeBytes,
    sizeFormatted: formatFileSize(sizeBytes),
  };
}

async function measureWithNode(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`URL không hợp lệ: ${targetUrl}`));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const startTime = process.hrtime.bigint();
    let dnsTime = null;
    let connectTime = null;
    let ttfbTime = null;
    let totalBytes = 0;

    const req = client.get(targetUrl, { timeout: 15000 }, (res) => {
      ttfbTime = process.hrtime.bigint();

      res.on('data', (chunk) => {
        totalBytes += chunk.length;
      });

      res.on('end', () => {
        const endTime = process.hrtime.bigint();
        const dnsMs = dnsTime ? Math.round(Number(dnsTime - startTime) / 1e6) : 0;
        const connectMs = connectTime && dnsTime ? Math.max(0, Math.round(Number(connectTime - dnsTime) / 1e6)) : 0;
        const ttfbMs = ttfbTime ? Math.round(Number(ttfbTime - startTime) / 1e6) : 0;
        const totalMs = Math.round(Number(endTime - startTime) / 1e6);

        resolve({
          method: 'node',
          statusCode: res.statusCode || 0,
          dnsMs,
          connectMs,
          ttfbMs,
          totalMs,
          sizeBytes: totalBytes,
          sizeFormatted: formatFileSize(totalBytes),
        });
      });
    });

    req.on('socket', (socket) => {
      socket.on('lookup', () => {
        dnsTime = process.hrtime.bigint();
      });
      socket.on('connect', () => {
        connectTime = process.hrtime.bigint();
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Yêu cầu hết thời gian chờ (timeout 15s)'));
    });
  });
}

async function measureHttpLatency(targetUrl) {
  try {
    return await measureWithCurl(targetUrl);
  } catch {
    return await measureWithNode(targetUrl);
  }
}

async function fetchPageSpeedScore(targetUrl, apiKey = null) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host) || host.startsWith('192.168.') || host.startsWith('10.')) {
      return { skipped: true, reason: 'URL là địa chỉ nội bộ, Google PageSpeed không thể truy cập từ bên ngoài.' };
    }

    let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile`;
    if (apiKey) {
      apiUrl += `&key=${apiKey}`;
    }

    const response = await axios.get(apiUrl, { timeout: 35000 });
    const data = response.data;
    const lighthouse = data?.lighthouseResult;
    const categories = lighthouse?.categories;
    const audits = lighthouse?.audits;

    const scoreRaw = categories?.performance?.score;
    const score = typeof scoreRaw === 'number' ? Math.round(scoreRaw * 100) : null;

    const fcp = audits?.['first-contentful-paint']?.displayValue || 'N/A';
    const lcp = audits?.['largest-contentful-paint']?.displayValue || 'N/A';
    const tbt = audits?.['total-blocking-time']?.displayValue || 'N/A';
    const cls = audits?.['cumulative-layout-shift']?.displayValue || 'N/A';

    return {
      ok: true,
      score,
      fcp,
      lcp,
      tbt,
      cls,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.response?.data?.error?.message || error.message || 'Không thể kết nối PageSpeed API',
    };
  }
}

module.exports = {
  measureHttpLatency,
  fetchPageSpeedScore,
};
