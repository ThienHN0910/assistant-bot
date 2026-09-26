function handleAliases(req, res, { depWhitelist, sendJson }) {
  const aliases = depWhitelist.listAliases ? depWhitelist.listAliases() : [];
  sendJson(res, 200, { ok: true, aliases });
}

async function handleExecSh(req, res, { config, depNodeManager, depNodeClient, depWhitelist, depRunner, httpClient, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const rawCmd = (body.command || '').trim();
    const targetNodeId = body.nodeId || 'gcp-master';

    if (!rawCmd) {
      sendJson(res, 400, { ok: false, error: 'Thiếu câu lệnh (command)' });
      return;
    }

    const selectedNode = await depNodeManager.getNode(targetNodeId, config);
    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    // Remote worker node execution
    if (!selectedNode.isLocal) {
      const normalizedCmd = rawCmd.replace(/^\//, '').trim();
      const remoteRes = await depNodeClient.execCommand(selectedNode, normalizedCmd, httpClient);
      
      let out = '';
      if (remoteRes.ok) {
        const lines = [`$ [${selectedNode.id}] ${normalizedCmd}`];
        if (remoteRes.stdout) lines.push(remoteRes.stdout.trimEnd());
        if (remoteRes.stderr) lines.push(`stderr: ${remoteRes.stderr.trimEnd()}`);
        if (typeof remoteRes.code !== 'undefined') lines.push(`[exit code: ${remoteRes.code}]`);
        out = lines.join('\n\n');
      } else {
        out = remoteRes.error || remoteRes.stderr || 'Lệnh thất bại';
      }

      sendJson(res, remoteRes.ok ? 200 : (remoteRes.status || 400), {
        ok: remoteRes.ok,
        node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
        output: out,
        error: remoteRes.ok ? undefined : out,
      });
      return;
    }

    // Local node execution
    const parts = rawCmd.split(/\s+/);
    const alias = parts[0].replace(/^\//, '');
    const args = parts.slice(1);

    let commands;
    try {
      commands = depWhitelist.getCommands(alias, args);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
      return;
    }

    const results = await depRunner.runSequence(commands, { timeoutMs: 60000 });
    const outputLines = [];
    for (let i = 0; i < commands.length; i++) {
      const step = commands[i];
      const r = results[i] || {};
      outputLines.push(`$ ${step.cmd} ${(step.args || []).join(' ')}`.trim());
      if (r.stdout) outputLines.push(r.stdout.trimEnd());
      if (r.stderr) outputLines.push(`stderr: ${r.stderr.trimEnd()}`);
      if (typeof r.code !== 'undefined') outputLines.push(`[exit code: ${r.code}]`);
    }

    sendJson(res, 200, {
      ok: results.every((r) => r.ok),
      node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
      output: outputLines.join('\n\n'),
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleAliases,
  handleExecSh,
};
