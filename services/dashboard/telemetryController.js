const fs = require('fs/promises');

async function handleNodes(req, res, { config, depNodeManager, sendJson }) {
  try {
    const rawNodes = await depNodeManager.getNodes(config);
    const nodes = rawNodes.map((n) => {
      const ipMasked = depNodeManager.maskIp ? depNodeManager.maskIp(n.ip) : (n.ip ? `${n.ip.split('.')[0]}.***` : '');
      return {
        id: n.id,
        name: n.name || n.id,
        isLocal: Boolean(n.isLocal),
        status: n.status || 'online',
        ipMasked,
        ip: ipMasked,
      };
    });
    sendJson(res, 200, { ok: true, nodes });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleStatus(req, res, { config, depSi, depNodeManager, depNodeClient, httpClient, formatFileSize, sendJson }) {
  try {
    const [cpu, mem, fsSize, time] = await Promise.all([
      depSi.currentLoad().catch(() => ({ currentLoad: 0 })),
      depSi.mem().catch(() => ({ total: 1, used: 0, free: 0 })),
      depSi.fsSize().catch(() => []),
      depSi.time(),
    ]);

    const rootDisk = fsSize.find((f) => f.mount === '/') || fsSize[0] || { size: 0, used: 0 };
    const localUptime = time?.uptime || process.uptime();

    const system = {
      cpuLoad: Math.round(cpu.currentLoad || 0),
      memory: {
        totalBytes: mem.total,
        usedBytes: mem.used,
        usedPercentage: Math.round((mem.used / (mem.total || 1)) * 100),
        formatted: `${formatFileSize(mem.used)} / ${formatFileSize(mem.total)}`,
      },
      disk: {
        totalBytes: rootDisk.size,
        usedBytes: rootDisk.used,
        usedPercentage: Math.round(rootDisk.use || 0),
        formatted: `${formatFileSize(rootDisk.used)} / ${formatFileSize(rootDisk.size)}`,
      },
      uptimeSeconds: localUptime,
      uptimeFormatted: `${Math.floor(localUptime / 86400)}d ${Math.floor((localUptime % 86400) / 3600)}h`,
    };

    const clusterNodesRaw = await depNodeManager.getNodes(config);
    const nodes = await Promise.all(
      clusterNodesRaw.map(async (node) => {
        const ipMasked = depNodeManager.maskIp ? depNodeManager.maskIp(node.ip) : (node.ip ? `${node.ip.split('.')[0]}.***` : '');
        if (node.isLocal) {
          return {
            id: node.id,
            name: node.name || node.id,
            isLocal: true,
            status: 'online',
            ipMasked,
            cpuLoad: system.cpuLoad,
            memory: system.memory,
            disk: system.disk,
            uptimeSeconds: system.uptimeSeconds,
            uptimeFormatted: system.uptimeFormatted,
          };
        }

        try {
          const res = await depNodeClient.getMetrics(node, httpClient);
          if (res && res.ok && res.metrics) {
            const memUsed = res.metrics.memory?.usedBytes || 0;
            const memTotal = res.metrics.memory?.totalBytes || 0;
            const memPct = memTotal > 0
              ? Math.round((memUsed / memTotal) * 100)
              : (Number(res.metrics.memory?.usedPercentage) || 0);
            const upSec = res.metrics.uptimeSeconds || 0;

            return {
              id: node.id,
              name: node.name || node.id,
              isLocal: false,
              status: 'online',
              ipMasked,
              cpuLoad: Number(res.metrics.cpuLoad) || 0,
              memory: {
                totalBytes: memTotal,
                usedBytes: memUsed,
                usedPercentage: memPct,
                formatted: `${formatFileSize(memUsed)} / ${formatFileSize(memTotal)}`,
              },
              disk: res.metrics.disk || {
                totalBytes: 0,
                usedBytes: 0,
                usedPercentage: 0,
                formatted: 'N/A',
              },
              uptimeSeconds: upSec,
              uptimeFormatted: `${Math.floor(upSec / 86400)}d ${Math.floor((upSec % 86400) / 3600)}h`,
            };
          }
          return {
            id: node.id,
            name: node.name || node.id,
            isLocal: false,
            status: 'offline',
            ipMasked,
            cpuLoad: 0,
            memory: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
            disk: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
            uptimeSeconds: 0,
            uptimeFormatted: 'Offline',
            error: res?.error || 'Node unreachable',
          };
        } catch (remoteErr) {
          return {
            id: node.id,
            name: node.name || node.id,
            isLocal: false,
            status: 'offline',
            ipMasked,
            cpuLoad: 0,
            memory: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
            disk: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
            uptimeSeconds: 0,
            uptimeFormatted: 'Offline',
            error: remoteErr.message,
          };
        }
      })
    );

    sendJson(res, 200, {
      ok: true,
      system,
      nodes,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleProcesses(req, res, { config, depNodeManager, depNodeClient, depSi, httpClient, urlObj, sendJson }) {
  try {
    const requestedNodeId = urlObj.searchParams.get('nodeId');
    let selectedNode = null;
    if (requestedNodeId) {
      selectedNode = await depNodeManager.getNode(requestedNodeId, config);
    } else {
      selectedNode = await depNodeManager.getNode('gcp-master', config).catch(() => ({ id: 'gcp-master', name: 'Master', isLocal: true }));
    }

    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    let rawProcesses = [];
    if (selectedNode.isLocal) {
      const procs = await depSi.processes().catch(() => ({ list: [] }));
      rawProcesses = procs.list || [];
    } else {
      const remoteRes = await depNodeClient.getProcesses(selectedNode, httpClient);
      if (!remoteRes.ok) {
        sendJson(res, 502, { ok: false, error: remoteRes.error || 'Không thể lấy tiến trình từ worker' });
        return;
      }
      rawProcesses = remoteRes.processes || [];
    }

    const sorted = [...rawProcesses]
      .sort((a, b) => (Number(b.mem) || 0) - (Number(a.mem) || 0))
      .slice(0, 10)
      .map((p) => ({
        pid: Number(p.pid) || 0,
        name: p.name || 'unknown',
        mem: Number(p.mem) || 0,
        cpu: Number(p.cpu) || 0,
        user: p.user || 'root',
      }));

    sendJson(res, 200, {
      ok: true,
      node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
      processes: sorted,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleLogs(req, res, { config, depNodeManager, depNodeClient, httpClient, readLastLines, urlObj, sendJson }) {
  try {
    const requestedNodeId = urlObj.searchParams.get('nodeId');
    const count = Math.max(1, Math.min(Number(urlObj.searchParams.get('lines')) || 20, 200));
    let selectedNode = null;
    if (requestedNodeId) {
      selectedNode = await depNodeManager.getNode(requestedNodeId, config);
    } else {
      selectedNode = await depNodeManager.getNode('gcp-master', config).catch(() => ({ id: 'gcp-master', name: 'Master', isLocal: true }));
    }

    if (!selectedNode) {
      sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
      return;
    }

    let logsText = '';
    if (selectedNode.isLocal) {
      const logPath = config?.pm2ErrorLogPath || process.env.PM2_ERROR_LOG_PATH;
      if (!logPath) {
        logsText = 'Chưa cấu hình PM2_ERROR_LOG_PATH';
      } else {
        try {
          await fs.access(logPath);
          logsText = await readLastLines(logPath, count);
        } catch {
          logsText = 'Không tìm thấy file log PM2 tại ' + logPath;
        }
      }
    } else {
      const remoteRes = await depNodeClient.getLogs(selectedNode, count, httpClient);
      if (!remoteRes.ok) {
        sendJson(res, 502, { ok: false, error: remoteRes.error || 'Không thể lấy log từ worker' });
        return;
      }
      logsText = remoteRes.log || '';
    }

    sendJson(res, 200, {
      ok: true,
      node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
      logs: logsText,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleNodes,
  handleStatus,
  handleProcesses,
  handleLogs,
};
