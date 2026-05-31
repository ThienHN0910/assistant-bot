const { spawn } = require('child_process');

function runCommand(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (err) {
      resolve({ cmd, args, ok: false, stdout: '', stderr: String(err), code: null });
      return;
    }

    let stdout = '';
    let stderr = '';
    const maxBuffer = opts.maxBuffer || 64 * 1024; // keep last N bytes
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30000;

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on('data', (d) => {
        stdout += d.toString();
        if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
      });
    }

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ cmd, args, ok: code === 0, stdout, stderr, code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ cmd, args, ok: false, stdout, stderr: String(err), code: null });
    });
  });
}

async function runSequence(list, opts = {}) {
  const results = [];
  for (const step of list) {
    const res = await runCommand(step.cmd, step.args || [], opts);
    results.push(res);
    if (!res.ok && opts.stopOnError !== false) break;
  }
  return results;
}

module.exports = {
  runSequence,
};
