const pendingDeploys = new Map();

function setPending(id, data) {
  pendingDeploys.set(id, { ...data, createdAt: Date.now() });
  setTimeout(() => pendingDeploys.delete(id), 15 * 60 * 1000);
}

function getPending(id) {
  return pendingDeploys.get(id);
}

function deletePending(id) {
  pendingDeploys.delete(id);
}

module.exports = {
  setPending,
  getPending,
  deletePending,
};
