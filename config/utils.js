const fs = require('fs/promises');

async function readLastLines(filePath, lineCount = 20) {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  // Loại bỏ dòng rỗng ở cuối file để đảm bảo trả về đúng số dòng log thực tế.
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-lineCount).join('\n');
}

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(2)} GB`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

module.exports = {
  readLastLines,
  formatBytes,
  formatPercent,
};
