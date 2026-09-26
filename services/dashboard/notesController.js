const fs = require('fs/promises');

async function handleGetNotes(req, res, { config, sendJson }) {
  try {
    const notesPath = config?.notesFilePath || './notes.txt';
    let notes = [];
    try {
      await fs.access(notesPath);
      const raw = await fs.readFile(notesPath, 'utf8');
      notes = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      notes = [];
    }
    sendJson(res, 200, { ok: true, notes });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateNote(req, res, { config, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const text = (body.text || '').trim();
    if (!text) {
      sendJson(res, 400, { ok: false, error: 'Thiếu nội dung ghi chú (text)' });
      return;
    }

    const notesPath = config?.notesFilePath || './notes.txt';
    const timestamp = new Date().toLocaleString('vi-VN', { hour12: false });
    const line = `[${timestamp}] ${text}\n`;
    await fs.appendFile(notesPath, line, 'utf8');

    sendJson(res, 200, { ok: true, message: 'Đã lưu ghi chú thành công' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteNotes(req, res, { config, sendJson }) {
  try {
    const notesPath = config?.notesFilePath || './notes.txt';
    await fs.writeFile(notesPath, '', 'utf8');
    sendJson(res, 200, { ok: true, message: 'Đã xóa toàn bộ ghi chú' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetNotes,
  handleCreateNote,
  handleDeleteNotes,
};
