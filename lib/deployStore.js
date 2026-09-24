const pendingDeploys = new Map();
const awaitingSubdomainUsers = new Map();

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

function setAwaitingSubdomain(userId, deployId) {
  awaitingSubdomainUsers.set(String(userId), deployId);
  setTimeout(() => awaitingSubdomainUsers.delete(String(userId)), 10 * 60 * 1000);
}

function getAwaitingSubdomain(userId) {
  return awaitingSubdomainUsers.get(String(userId));
}

function clearAwaitingSubdomain(userId) {
  awaitingSubdomainUsers.delete(String(userId));
}

module.exports = {
  setPending,
  getPending,
  deletePending,
  setAwaitingSubdomain,
  getAwaitingSubdomain,
  clearAwaitingSubdomain,
};
