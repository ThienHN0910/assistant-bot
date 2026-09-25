const assert = require('assert');
const repoInspector = require('../lib/repoInspector');

async function testRepoInspector() {
  // 1. URL Parsing
  assert.deepStrictEqual(
    repoInspector.parseGithubUrl('https://github.com/ThienHN0910/my-portfolio'),
    { owner: 'ThienHN0910', repo: 'my-portfolio' }
  );
  assert.deepStrictEqual(
    repoInspector.parseGithubUrl('https://github.com/facebook/react.git'),
    { owner: 'facebook', repo: 'react' }
  );
  assert.deepStrictEqual(
    repoInspector.parseGithubUrl('https://github.com/vuejs/core/tree/main'),
    { owner: 'vuejs', repo: 'core' }
  );
  assert.throws(() => repoInspector.parseGithubUrl('https://gitlab.com/owner/repo'), /Invalid GitHub/);
  console.log('✅ parseGithubUrl tests passed');

  // 2. Pure Static Repo (has index.html, no package.json)
  const mockStaticClient = {
    get: async (url) => {
      if (url.includes('/contents/')) {
        return {
          data: [
            { name: 'index.html', type: 'file', path: 'index.html' },
            { name: 'style.css', type: 'file', path: 'style.css' },
            { name: 'app.js', type: 'file', path: 'app.js' },
          ],
        };
      }
      return { data: { default_branch: 'main' } };
    },
  };

  const staticRes = await repoInspector.inspectRepo(
    'https://github.com/john/simple-landing',
    { client: mockStaticClient }
  );
  assert.strictEqual(staticRes.ok, true);
  assert.strictEqual(staticRes.type, 'static_pure');
  assert(staticRes.targets.includes('vps'), 'Static pure should allow VPS target');
  assert(staticRes.targets.includes('vercel'), 'Static pure should allow Vercel target');
  assert.strictEqual(staticRes.defaultTarget, 'vps');
  console.log('✅ pure static repo detection passed');

  // 3. Frontend SPA Repo (React + Vite)
  const mockReactClient = {
    get: async (url) => {
      if (url.includes('/contents/package.json')) {
        return {
          data: {
            content: Buffer.from(
              JSON.stringify({
                name: 'my-react-app',
                dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
                devDependencies: { vite: '^4.4.0', '@vitejs/plugin-react': '^4.0.0' },
                scripts: { build: 'vite build' },
              })
            ).toString('base64'),
            encoding: 'base64',
          },
        };
      }
      if (url.includes('/contents/')) {
        return {
          data: [
            { name: 'package.json', type: 'file', path: 'package.json' },
            { name: 'src', type: 'dir', path: 'src' },
            { name: 'index.html', type: 'file', path: 'index.html' },
            { name: 'vite.config.js', type: 'file', path: 'vite.config.js' },
          ],
        };
      }
      return { data: { default_branch: 'main' } };
    },
  };

  const reactRes = await repoInspector.inspectRepo(
    'https://github.com/john/my-react-shop',
    { client: mockReactClient }
  );
  assert.strictEqual(reactRes.ok, true);
  assert.strictEqual(reactRes.type, 'frontend_spa');
  assert(reactRes.frameworks.includes('React'));
  assert(reactRes.frameworks.includes('Vite'));
  assert.deepStrictEqual(reactRes.targets, ['vercel']);
  assert.strictEqual(reactRes.defaultTarget, 'vercel');
  console.log('✅ frontend SPA (React + Vite) detection passed');

  // 4. Backend API Repo (Express)
  const mockBackendClient = {
    get: async (url) => {
      if (url.includes('/contents/package.json')) {
        return {
          data: {
            content: Buffer.from(
              JSON.stringify({
                name: 'my-api',
                dependencies: { express: '^4.18.2', cors: '^2.8.5' },
                scripts: { start: 'node server.js' },
              })
            ).toString('base64'),
            encoding: 'base64',
          },
        };
      }
      if (url.includes('/contents/')) {
        return {
          data: [
            { name: 'package.json', type: 'file', path: 'package.json' },
            { name: 'server.js', type: 'file', path: 'server.js' },
          ],
        };
      }
      return { data: { default_branch: 'main' } };
    },
  };

  const backendRes = await repoInspector.inspectRepo(
    'https://github.com/john/express-api',
    { client: mockBackendClient }
  );
  assert.strictEqual(backendRes.ok, true);
  assert.strictEqual(backendRes.type, 'backend_api');
  assert(backendRes.frameworks.includes('Express'));
  assert.deepStrictEqual(backendRes.targets, ['render']);
  assert.strictEqual(backendRes.defaultTarget, 'render');
  console.log('✅ backend API detection passed');

  // 5. Monorepo (Client + Server subfolders)
  const mockMonorepoClient = {
    get: async (url) => {
      if (url.includes('/contents/frontend/package.json') || url.includes('/contents/client/package.json')) {
        return {
          data: {
            content: Buffer.from(
              JSON.stringify({
                name: 'client',
                dependencies: { vue: '^3.3.0' },
                devDependencies: { vite: '^4.4.0' },
              })
            ).toString('base64'),
            encoding: 'base64',
          },
        };
      }
      if (url.includes('/contents/backend/package.json') || url.includes('/contents/server/package.json')) {
        return {
          data: {
            content: Buffer.from(
              JSON.stringify({
                name: 'server',
                dependencies: { express: '^4.18.2' },
              })
            ).toString('base64'),
            encoding: 'base64',
          },
        };
      }
      if (url.includes('/contents/')) {
        return {
          data: [
            { name: 'frontend', type: 'dir', path: 'frontend' },
            { name: 'backend', type: 'dir', path: 'backend' },
            { name: 'README.md', type: 'file', path: 'README.md' },
          ],
        };
      }
      return { data: { default_branch: 'main' } };
    },
  };

  const monoRes = await repoInspector.inspectRepo(
    'https://github.com/john/fullstack-app',
    { client: mockMonorepoClient }
  );
  assert.strictEqual(monoRes.ok, true);
  assert.strictEqual(monoRes.type, 'monorepo');
  assert(monoRes.frontend, 'Should detect frontend partition');
  assert(monoRes.backend, 'Should detect backend partition');
  assert(monoRes.frontend.frameworks.includes('Vue'));
  assert(monoRes.backend.frameworks.includes('Express'));
  assert(monoRes.targets.includes('vercel'));
  assert(monoRes.targets.includes('render'));
  assert(monoRes.targets.includes('both'));
  assert.strictEqual(monoRes.defaultTarget, 'both');
  console.log('✅ monorepo detection passed');

  // 6. 404 / Missing Repo error handling
  const mock404Client = {
    get: async () => {
      const err = new Error('Not Found');
      err.response = { status: 404 };
      throw err;
    },
  };
  await assert.rejects(
    () => repoInspector.inspectRepo('https://github.com/not/found', { client: mock404Client }),
    /không tồn tại hoặc đang ở chế độ private/i
  );
  console.log('✅ 404 repo error handling passed');
}

testRepoInspector().catch((err) => {
  console.error('Repo inspector test failed:', err);
  process.exit(1);
});
