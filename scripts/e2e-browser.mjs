#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = mkdtempSync(join(tmpdir(), 'miobridge-browser-e2e.'));
const mainDir = join(tmpDir, 'main');
const agentDir = join(tmpDir, 'agent');
const chromeProfileDir = join(tmpDir, 'chrome');
const mainPort = Number(process.env.MAIN_PORT || 43111);
const agentPort = Number(process.env.AGENT_PORT || 43112);
const cdpPort = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || 43113);
const secret = 'browser-e2e-secret-32chars';
const children = [];
let cleaned = false;

function logTail(label, buffer) {
  console.error(`--- ${label} ---`);
  console.error(buffer.join('').split('\n').slice(-120).join('\n'));
}

function spawnLogged(label, command, args, options = {}) {
  const logs = [];
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.on('exit', (code, signal) => logs.push(`\n[${label} exited code=${code} signal=${signal}]\n`));
  children.push({ label, child, logs });
  return child;
}

function cleanup(status = 0) {
  if (cleaned) return;
  cleaned = true;
  if (status !== 0) {
    for (const entry of children) logTail(entry.label, entry.logs);
  }
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Chrome can keep profile files open briefly after SIGTERM; temp cleanup is best-effort.
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup(1);
  process.exit(1);
});

function setupRuntimeFiles() {
  mkdirSync(join(mainDir, 'bin'), { recursive: true });
  mkdirSync(join(mainDir, 'www'), { recursive: true });
  mkdirSync(agentDir, { recursive: true });

  const mihomoPath = join(mainDir, 'bin', 'mihomo');
  writeFileSync(mihomoPath, `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -v|version) echo "Mihomo Meta browser-e2e" ;;
  -t) exit 0 ;;
  *) echo "mihomo browser e2e stub" ;;
esac
`);
  writeFileSync(join(mainDir, 'bin', 'yq'), `#!/usr/bin/env bash
set -euo pipefail
file="\${@: -1}"
if [[ "$*" == *"--output-format=json"* ]]; then
  echo '{}'
  exit 0
fi
node - "$file" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function dump(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) return value.map(item => {
    if (item && typeof item === 'object') {
      const lines = dump(item, indent + 2).split('\\n');
      return \`\${pad}- \${lines[0].trimStart()}\\n\${lines.slice(1).join('\\n')}\`;
    }
    return \`\${pad}- \${JSON.stringify(item)}\`;
  }).join('\\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, child]) => {
    if (child && typeof child === 'object') return \`\${pad}\${key}:\\n\${dump(child, indent + 2)}\`;
    return \`\${pad}\${key}: \${JSON.stringify(child)}\`;
  }).join('\\n');
  return \`\${pad}\${JSON.stringify(value)}\`;
}
console.log(dump(data));
NODE
`);
  chmodSync(mihomoPath, 0o755);
  chmodSync(join(mainDir, 'bin', 'yq'), 0o755);

  writeFileSync(join(agentDir, 'xray.json'), JSON.stringify({
    inbounds: [{
      tag: 'browser-vless',
      protocol: 'vless',
      port: 443,
      settings: { clients: [{ id: '00000000-0000-4000-8000-000000000002' }] },
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings: { serverName: 'browser.example.com' },
      },
    }],
  }, null, 2));

  writeFileSync(join(agentDir, 'v2ray.json'), JSON.stringify({
    inbounds: [{
      tag: 'browser-v2ray',
      protocol: 'vless',
      port: 8443,
      settings: { clients: [{ id: '00000000-0000-4000-8000-000000000004' }] },
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings: { serverName: 'v2ray.browser.example.com' },
      },
    }],
  }, null, 2));

  writeFileSync(join(agentDir, 'agent.yaml'), `node:
  id: "browser-agent"
  name: "Browser Agent"
  secret: "${secret}"
kernels:
  - type: "xray"
    configPath: "${join(agentDir, 'xray.json')}"
  - type: "v2ray"
    configPath: "${join(agentDir, 'v2ray.json')}"
mihomo:
  path: "${mihomoPath}"
port: ${agentPort}
`);

  writeFileSync(join(mainDir, 'nodes.yaml'), `nodes:
  - id: "browser-agent"
    name: "Browser Agent"
    host: "0.0.0.0"
    port: ${agentPort}
    secret: "${secret}"
    kernels:
      - type: "xray"
      - type: "v2ray"
    location: "browser-e2e"
    enabled: true
`);
}

async function waitForHttp(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome/Chromium not found. Set CHROME_PATH to run browser E2E.');
  }
  return found;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 10_000);
    });
  }
}

async function connectChrome() {
  const chrome = spawnLogged('chrome', findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${chromeProfileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    'about:blank',
  ]);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((res) => res.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return { chrome, cdp: new CdpClient(ws) };
}

async function waitForText(cdp, sessionId, text) {
  let lastBody = '';
  let lastHref = '';
  for (let i = 0; i < 80; i++) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        href: location.href,
        body: document.body ? document.body.innerText : '',
        found: !!document.body && document.body.innerText.includes(${JSON.stringify(text)})
      }))()`,
      returnByValue: true,
    }, sessionId);
    lastHref = result.result.value?.href || '';
    lastBody = result.result.value?.body || '';
    if (result.result.value?.found) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Text not found in browser: ${text}\nURL: ${lastHref}\nBody:\n${lastBody}`);
}

async function clickText(cdp, sessionId, text) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const wanted = ${JSON.stringify(text)};
      const elements = Array.from(document.querySelectorAll('button,h1,h2,h3,h4,a,span,p,div'))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          return visible && el.textContent && el.textContent.trim() === wanted;
        });
      const el = elements[0];
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
  }, sessionId);
  const point = result.result.value;
  assert(point, `Clickable text not found: ${text}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: point.x, y: point.y }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: point.x, y: point.y }, sessionId);
}

async function run() {
  setupRuntimeFiles();
  assert(existsSync(join(rootDir, 'frontend/.next/standalone/frontend/server.js')), 'standalone build is missing; run bun run build');

  spawnLogged('agent', 'bun', [join(rootDir, 'agent/src/server.ts')], {
    env: { MIOBRIDGE_AGENT_CONFIG: join(agentDir, 'agent.yaml') },
  });
  spawnLogged('main', 'node', [join(rootDir, 'frontend/.next/standalone/frontend/server.js')], {
    env: {
      PORT: String(mainPort),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      MIOBRIDGE_CONFIG_DIR: mainDir,
    },
  });

  await waitForHttp(`http://127.0.0.1:${agentPort}/api/health`);
  await waitForHttp(`http://127.0.0.1:${mainPort}/health`);

  const agentUrls = await fetch(`http://127.0.0.1:${agentPort}/api/urls`).then((response) => response.json());
  assert.deepEqual(agentUrls.data.sources.map((source) => source.kernel), ['xray', 'v2ray']);
  assert.deepEqual(
    agentUrls.data.kernels.filter((kernel) => kernel.monitored).map((kernel) => kernel.type),
    ['xray', 'v2ray'],
  );

  const { cdp } = await connectChrome();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${mainPort}/` }, sessionId);

  await waitForText(cdp, sessionId, '总览');
  await waitForText(cdp, sessionId, '子节点内核');
  await waitForText(cdp, sessionId, '2/2 可用');

  await clickText(cdp, sessionId, '节点');
  await waitForText(cdp, sessionId, 'Browser Agent');
  await waitForText(cdp, sessionId, '节点生命周期');

  await clickText(cdp, sessionId, 'Browser Agent');
  await waitForText(cdp, sessionId, '在线状态');
  await waitForText(cdp, sessionId, '代理数量');
  await waitForText(cdp, sessionId, 'Xray');
  await waitForText(cdp, sessionId, 'V2Ray');
  await waitForText(cdp, sessionId, '1 个代理');

  await clickText(cdp, sessionId, 'Close');
  await waitForText(cdp, sessionId, '节点生命周期');

  await clickText(cdp, sessionId, '添加节点');
  await waitForText(cdp, sessionId, '添加节点');
  await clickText(cdp, sessionId, '取消');

  await clickText(cdp, sessionId, '检查');
  await waitForText(cdp, sessionId, 'Browser Agent');

  console.log('browser e2e passed');
  cleanup(0);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  cleanup(1);
  process.exit(1);
});
