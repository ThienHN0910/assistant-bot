const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * Writes JSON via a temp file + rename so an interrupted write never leaves a truncated file.
 * On Windows (or cross-device moves) rename can fail on an existing target, so fall back to copy.
 */
async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fs.rename(tempPath, filePath);
    } catch (renameErr) {
      if (process.platform === 'win32' || renameErr.code === 'EXDEV' || renameErr.code === 'EPERM') {
        await fs.copyFile(tempPath, filePath);
        await fs.rm(tempPath, { force: true }).catch(() => {});
      } else {
        throw renameErr;
      }
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Runs async read-modify-write tasks one at a time (per queue instance). */
function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

module.exports = { writeJsonAtomic, createSerialQueue };
