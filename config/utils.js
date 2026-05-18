const fs = require('fs/promises');

function escapeMarkdown(value) {
  return String(value).replace(/([_\-*\[\]()~`>#+=|{}.!])/g, '\\$1');
}

async function readLastLines(filePath, lineCount = 20) {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
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
  escapeMarkdown,
  readLastLines,
  formatBytes,
  formatPercent,
};
