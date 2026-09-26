const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function deployZipPayload(zipBuffer, projectName, subdomain) {
  return {
    ok: true,
    projectName,
    subdomain,
    type: 'static',
    domain: `${subdomain}.thienhn.io.vn`,
  };
}

async function removeProject(projectName) {
  return { ok: true, projectName };
}

async function runSelfUpdate() {
  try {
    const { stdout } = await execFileAsync('git', ['pull', 'origin', 'main'], { timeout: 30000 });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function restartSelf() {
  execFile('pm2', ['restart', 'assistant-node-agent'], () => {});
}

module.exports = {
  deployZipPayload,
  removeProject,
  runSelfUpdate,
  restartSelf,
};
