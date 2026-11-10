const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { readLastLines, escapeHtml, buildStepOutput, formatNoteLine, zipExtractCommand } = require('../config/utils');

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

function testBuildStepOutput() {
  const out = buildStepOutput({ cmd: 'git', args: ['pull'] }, { ok: false, stdout: 'a\n', stderr: 'b', code: 1 });
  const expected = ['Lệnh: git pull', 'Trạng thái: Thất bại', '', 'stdout:', 'a', '', 'stderr:', 'b', '', 'exit code: 1'];
  assert.strictEqual(out, expected.join('\n'));
  console.log('✅ buildStepOutput test passed');
}

function testFormatNoteLine() {
  // 2026-01-01T00:30Z is 07:30 in Asia/Ho_Chi_Minh, regardless of the server's own timezone
  const line = formatNoteLine('hello', 'Asia/Ho_Chi_Minh', new Date('2026-01-01T00:30:00Z'));
  assert.ok(line.includes('07:30'), `expected local time in ${line}`);
  assert.ok(line.endsWith('] hello\n'));
  console.log('✅ formatNoteLine test passed');
}

function testZipExtractCommand() {
  assert.deepStrictEqual(zipExtractCommand('a.zip', 'out', 'linux'), ['unzip', ['-o', 'a.zip', '-d', 'out']]);
  const [bin, args] = zipExtractCommand('a.zip', 'out', 'win32');
  assert.ok(/System32[\\/]tar\.exe$/i.test(bin), bin);
  assert.deepStrictEqual(args, ['-xf', 'a.zip', '-C', 'out']);
  console.log('✅ zipExtractCommand test passed');
}

async function run() {
  testEscapeHtml();
  testBuildStepOutput();
  testFormatNoteLine();
  testZipExtractCommand();
  await testReadLastLines();
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
