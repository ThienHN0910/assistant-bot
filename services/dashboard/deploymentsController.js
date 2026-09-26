const { execFile } = require('child_process');

async function handleDeploymentsList(req, res, { config, depNodeManager, depDeployer, sendJson }) {
  try {
    const clusterNodesRaw = await depNodeManager.getNodes(config).catch(() => []);
    const clusterNodesMap = new Map(clusterNodesRaw.map((n) => [n.id, n]));
    const rawDeployments = await depDeployer.listAllDeployments(config);
    const deployments = rawDeployments.map((d) => {
      let dnsTarget = 'Chưa xác định';
      if (d.target === 'vps') {
        const node = clusterNodesMap.get(d.nodeId || 'gcp-master');
        const targetIp = node?.ip || config.vpsPublicIp || '';
        const maskedIp = depNodeManager.maskIp ? depNodeManager.maskIp(targetIp) : (targetIp ? `${targetIp.split('.')[0]}.***` : 'VPS IP');
        dnsTarget = `A Record -> ${maskedIp || 'VPS IP'}`;
      } else if (d.target === 'vercel') {
        dnsTarget = `CNAME -> ${d.cnameTarget || 'cname.vercel-dns.com'}`;
      } else if (d.target === 'render') {
        dnsTarget = `CNAME -> ${d.cnameTarget || '*.onrender.com'}`;
      }
      return { ...d, dnsTarget };
    });
    sendJson(res, 200, { ok: true, deployments });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleInspectRepo(req, res, { config, depInspector, depDeployer, httpClient, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    if (!body.repoUrl) {
      sendJson(res, 400, { ok: false, error: 'Thiếu repoUrl' });
      return;
    }
    const inspection = await depInspector.inspectRepo(body.repoUrl, { client: httpClient });
    const suggestedSubdomain = await depDeployer.resolveAvailableSubdomain(inspection.repo, config);
    sendJson(res, 200, {
      ok: true,
      inspection,
      suggestedSubdomain,
      baseDomain: config.baseDomain || 'thienhn.io.vn',
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeployGit(req, res, { config, depDeployer, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    if (!body.repoUrl || !body.target) {
      sendJson(res, 400, { ok: false, error: 'Thiếu thông tin repoUrl hoặc target' });
      return;
    }
    const result = await depDeployer.deploy(
      {
        source: 'github_public',
        repoUrl: body.repoUrl,
        projectName: body.projectName || body.subdomain,
        target: body.target,
        subdomain: body.subdomain,
        nodeId: body.nodeId,
      },
      config
    );
    sendJson(res, 200, { ok: true, deployment: result.deployment });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleUndeploy(req, res, { config, depDeployer, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    if (!body.name) {
      sendJson(res, 400, { ok: false, error: 'Thiếu tên dự án cần xóa (name)' });
      return;
    }
    const result = await depDeployer.undeploy(body.name, config);
    sendJson(res, 200, { ok: true, undeployed: result });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleCleanCache(req, res, { config, depNodeManager, depNodeClient, depExecAsync, httpClient, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const targetNodeId = body.nodeId || 'gcp-master';

    if (targetNodeId === 'all') {
      const allNodes = await depNodeManager.getNodes(config);
      const results = [];
      for (const node of allNodes) {
        if (node.isLocal) {
          if (process.platform === 'linux') {
            await depExecAsync('sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches').catch(() => {});
          }
          await depExecAsync('pm2 flush').catch(() => {});
          results.push({ node: node.name || node.id, ok: true, result: 'Flushed & dropped caches' });
        } else {
          const remoteRes = await depNodeClient.cleanCache(node, httpClient);
          results.push({ node: node.name || node.id, ok: remoteRes.ok, result: remoteRes.result || remoteRes.error });
        }
      }
      sendJson(res, 200, { ok: true, results });
      return;
    }

    const selectedNode = await depNodeManager.getNode(targetNodeId, config);
    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    if (selectedNode.isLocal) {
      if (process.platform === 'linux') {
        await depExecAsync('sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches').catch(() => {});
      }
      await depExecAsync('pm2 flush').catch(() => {});
      sendJson(res, 200, {
        ok: true,
        node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
        result: { pm2Flush: 'flushed', cacheFreed: 'Đã giải phóng cache RAM và flush log PM2' },
      });
      return;
    }

    const remoteRes = await depNodeClient.cleanCache(selectedNode, httpClient);
    sendJson(res, remoteRes.ok ? 200 : 502, {
      ok: remoteRes.ok,
      node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
      result: remoteRes.result || { error: remoteRes.error },
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleRestartApp(req, res, { config, depNodeManager, depNodeClient, httpClient, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const targetNodeId = body.nodeId || 'gcp-master';
    const selectedNode = await depNodeManager.getNode(targetNodeId, config);
    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    if (selectedNode.isLocal) {
      const processName = process.env.PM2_PROCESS_NAME || config?.pm2ProcessName || 'assistant-bot';
      setTimeout(() => {
        execFile('pm2', ['restart', processName, '--update-env', '--max-memory-restart', '200M'], () => {});
      }, 1200);
      sendJson(res, 200, {
        ok: true,
        message: `Tiến trình PM2 "${processName}" trên ${selectedNode.name || 'Master'} sẽ khởi động lại trong 1-2 giây.`,
      });
      return;
    }

    const remoteRes = await depNodeClient.restartAgent(selectedNode, httpClient);
    sendJson(res, remoteRes.ok ? 200 : 502, {
      ok: remoteRes.ok,
      message: remoteRes.message || (remoteRes.ok ? 'Worker Agent đang khởi động lại' : remoteRes.error),
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateNode(req, res, { config, depNodeManager, depNodeClient, depWhitelist, depRunner, httpClient, sendJson, parseJsonBody }) {
  try {
    const body = await parseJsonBody(req);
    const targetNodeId = body.nodeId || 'gcp-master';

    if (targetNodeId === 'all') {
      const allNodes = await depNodeManager.getNodes(config);
      const results = [];
      for (const node of allNodes) {
        if (node.isLocal) {
          const commands = [{ cmd: 'git', args: ['pull', 'origin', 'main'] }, { cmd: 'npm', args: ['install', '--omit=dev'] }];
          const runResults = await depRunner.runSequence(commands, { timeoutMs: 90000 });
          results.push({ node: node.name || node.id, ok: true, output: runResults });
        } else {
          const remoteRes = await depNodeClient.update(node, httpClient);
          results.push({ node: node.name || node.id, ok: remoteRes.ok, output: remoteRes.output || remoteRes.error });
        }
      }
      sendJson(res, 200, { ok: true, results });
      return;
    }

    const selectedNode = await depNodeManager.getNode(targetNodeId, config);
    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    if (selectedNode.isLocal) {
      let commands = [{ cmd: 'git', args: ['pull', 'origin', 'main'] }, { cmd: 'npm', args: ['install', '--omit=dev'] }];
      try {
        commands = depWhitelist.getCommands('update', []);
      } catch {}
      const results = await depRunner.runSequence(commands, { timeoutMs: 90000 });
      const success = results.every((r) => r.ok);
      if (success) {
        const processName = process.env.PM2_PROCESS_NAME || config?.pm2ProcessName || 'assistant-bot';
        setTimeout(() => {
          execFile('pm2', ['restart', processName, '--update-env', '--max-memory-restart', '200M'], () => {});
        }, 1500);
      }
      sendJson(res, 200, {
        ok: success,
        node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
        output: results,
      });
      return;
    }

    const remoteRes = await depNodeClient.update(selectedNode, httpClient);
    sendJson(res, remoteRes.ok ? 200 : 502, {
      ok: remoteRes.ok,
      node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
      output: remoteRes.output || remoteRes.error,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleDeploymentsList,
  handleInspectRepo,
  handleDeployGit,
  handleUndeploy,
  handleCleanCache,
  handleRestartApp,
  handleUpdateNode,
};
