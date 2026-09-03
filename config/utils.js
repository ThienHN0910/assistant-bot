const fs = require('fs/promises');
const { execFile } = require('child_process');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Đọc N dòng cuối của file một cách an toàn cho bộ nhớ (OOM-safe trên VPS 1GB RAM).
 * Ưu tiên dùng lệnh `tail -n` trên Linux/Unix để không tốn bộ nhớ Node.js.
 * Fallback: Đọc tối đa 64KB từ đuôi file qua seek position, không bao giờ nạp cả file lớn vào RAM.
 */
async function readLastLines(filePath, lineCount = 20) {
  if (process.platform !== 'win32') {
    try {
      return await new Promise((resolve, reject) => {
        execFile('tail', ['-n', String(lineCount), filePath], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
          if (error) return reject(error);
          resolve((stdout || '').trimEnd());
        });
      });
    } catch {
      // Fallback xuống đọc chunk cuối nếu tail gặp sự cố
    }
  }

  // Fallback seek buffer an toàn
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size === 0) return '';

    const maxChunk = 64 * 1024; // 64KB
    const readLength = Math.min(stat.size, maxChunk);
    const position = stat.size - readLength;
    const buffer = Buffer.alloc(readLength);

    await handle.read(buffer, 0, readLength, position);
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);

    while (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.slice(-lineCount).join('\n');
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(2)} GB`;
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

module.exports = {
  escapeHtml,
  readLastLines,
  formatBytes,
  formatFileSize,
  formatPercent,
};
