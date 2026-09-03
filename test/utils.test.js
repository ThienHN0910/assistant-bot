const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { readLastLines, escapeHtml } = require('../config/utils');

async function testReadLastLines() {
  const tempFile = path.join(__dirname, 'test_temp_log.txt');
  const lines = Array.from({ length: 50 }, (_, i) => `Log line ${i + 1}`);
  await fs.writeFile(tempFile, lines.join('\n'), 'utf8');

  try {
    const result = await readLastLines(tempFile, 10);
    const resultLines = result.split(/\r?\n/);
    assert.strictEqual(resultLines.length, 10, 'Should return exactly 10 lines');
    assert.strictEqual(resultLines[resultLines.length - 1], 'Log line 50', 'Last line should be line 50');
    assert.strictEqual(resultLines[0], 'Log line 41', 'First line should be line 41');
    console.log('✅ readLastLines test passed');
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
}

function testEscapeHtml() {
  const raw = '<script>alert("test & win")</script>';
  const escaped = escapeHtml(raw);
  assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;test &amp; win&quot;)&lt;/script&gt;');
  console.log('✅ escapeHtml test passed');
}

async function run() {
  testEscapeHtml();
  await testReadLastLines();
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
