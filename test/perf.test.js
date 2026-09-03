const assert = require('assert');
const http = require('http');
const perf = require('../lib/perf');
const perfCommand = require('../commands/perf');

async function testPerfLatency() {
  // Tạo một mock server nhỏ để test đo latency
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello Performance Benchmark');
    }, 20); // Giả lập độ trễ 20ms
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}`;

  try {
    const result = await perf.measureHttpLatency(targetUrl);
    assert.strictEqual(result.statusCode, 200, 'Status code should be 200');
    assert(result.totalMs >= 15, 'Total ms should reflect server response time');
    assert(result.sizeBytes > 0, 'Size bytes should be greater than 0');
    console.log('✅ perf measureHttpLatency test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testPageSpeedLocalSkip() {
  const localUrl = 'http://127.0.0.1:8081';
  const result = await perf.fetchPageSpeedScore(localUrl);
  assert.strictEqual(result.skipped, true, 'Local URL should be skipped for PageSpeed');
  console.log('✅ perf fetchPageSpeedScore local skip test passed');
}

async function testPerfCommand() {
  assert.strictEqual(perfCommand.name, 'perf');
  assert.strictEqual(typeof perfCommand.execute, 'function');
  console.log('✅ perf command definition test passed');
}

async function run() {
  await testPerfLatency();
  await testPageSpeedLocalSkip();
  await testPerfCommand();
}

run().catch((err) => {
  console.error('Perf test failed:', err);
  process.exit(1);
});
