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

/**
 * tar binary to use. On Windows the System32 bsdtar is used explicitly: Git's GNU tar
 * (often first on PATH) treats "C:\\..." as a remote host.
 */
function tarBinary(platform = process.platform) {
  if (platform !== 'win32') return 'tar';
  return require('path').join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

/** Command that unpacks a ZIP into a directory (bsdtar on Windows, unzip elsewhere). */
function zipExtractCommand(zipFilePath, targetDir, platform = process.platform) {
  if (platform === 'win32') return [tarBinary(platform), ['-xf', zipFilePath, '-C', targetDir]];
  return ['unzip', ['-o', zipFilePath, '-d', targetDir]];
}

/** Plain-text report of one whitelisted shell step (shared by /sh and /update). */
function buildStepOutput(step, res) {
  const parts = [];
  parts.push(`Lệnh: ${step.cmd} ${(step.args || []).join(' ')}`.trim());
  parts.push(`Trạng thái: ${res.ok ? 'Thành công' : 'Thất bại'}`);
  if (res.stdout) {
    parts.push('', 'stdout:', res.stdout.trimEnd());
  }
  if (res.stderr) {
    parts.push('', 'stderr:', res.stderr.trimEnd());
  }
  if (typeof res.code !== 'undefined') {
    parts.push('', `exit code: ${res.code}`);
  }
  return parts.join('\n');
}

/** One notes.txt line; Telegram and Dashboard must stamp notes in the same timezone. */
function formatNoteLine(text, timezone = 'Asia/Ho_Chi_Minh', now = new Date()) {
  const timestamp = now.toLocaleString('vi-VN', { timeZone: timezone, hour12: false });
  return `[${timestamp}] ${text}\n`;
}

module.exports = {
  escapeHtml,
  buildStepOutput,
  tarBinary,
  zipExtractCommand,
  formatNoteLine,
  readLastLines,
  formatBytes,
  formatFileSize,
  formatPercent,
};
