const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeJsonAtomic, createSerialQueue } = require('../lib/jsonFile');
const nodeManager = require('../lib/nodeManager');

async function testWriteJsonAtomicLeavesNoTempFiles() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonfile-'));
  try {
    const file = path.join(dir, 'nested', 'data.json');
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 }); // overwrite an existing file (rename/copy fallback)
    assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), { a: 2 });
    const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'));
    assert.deepStrictEqual(leftovers, []);
    console.log('✅ writeJsonAtomic test passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testSerialQueueRunsInOrderAndSurvivesErrors() {
  const enqueue = createSerialQueue();
  const order = [];
  const slow = enqueue(async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); });
  const failing = enqueue(async () => { order.push(2); throw new Error('boom'); });
  const after = enqueue(async () => { order.push(3); return 'ok'; });
  await slow;
  await assert.rejects(failing, /boom/);
  assert.strictEqual(await after, 'ok');
  assert.deepStrictEqual(order, [1, 2, 3]);
  console.log('✅ createSerialQueue test passed');
}

async function testConcurrentAddNodeKeepsEveryNode() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodes-'));
  try {
    const config = { nodesConfigPath: path.join(dir, 'nodes.json') };
    await nodeManager.saveNodes([], config);
    await Promise.all(['a', 'b', 'c', 'd'].map((id, i) => nodeManager.addNode({ id, ip: `10.0.0.${i + 1}` }, config)));
    const ids = JSON.parse(await fs.readFile(config.nodesConfigPath, 'utf8')).map((n) => n.id).sort();
    // getNodes() seeds the default local node when the file is empty; all four added nodes must survive.
    for (const id of ['a', 'b', 'c', 'd']) assert.ok(ids.includes(id), `missing node ${id}: ${ids}`);
    console.log('✅ concurrent addNode test passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

(async () => {
  await testWriteJsonAtomicLeavesNoTempFiles();
  await testSerialQueueRunsInOrderAndSurvivesErrors();
  await testConcurrentAddNodeKeepsEveryNode();
})().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
