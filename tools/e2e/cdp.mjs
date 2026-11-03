// Utilitários CDP: Chrome headless + página + entrada real (mouse/teclado).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9341, profile, width = 1400, height = 900, extraArgs = [] }) {
  mkdirSync(profile, { recursive: true });
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, ...extraArgs, 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 80; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* espera */ }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(d.params.type)) logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('[log] ' + d.params.entry.text + ' ' + (d.params.entry.url ?? ''));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, (d) => r(d.result ?? { __error: d.error })); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + '\n' + expr.slice(0, 200));
    return r.result?.value;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const mouse = async (type, x, y, button = 'none', buttons = 0, clickCount = 0) =>
    send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });
  const api = {
    chrome, ws, send, ev, logs,
    async shot(path) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(s.data, 'base64'));
    },
    async move(x, y) { await mouse('mouseMoved', x, y); },
    async click(x, y, button = 'left') {
      const b = { left: 1, right: 2, middle: 4 }[button];
      await mouse('mouseMoved', x, y);
      await sleep(30);
      await mouse('mousePressed', x, y, button, b, 1);
      await sleep(40);
      await mouse('mouseReleased', x, y, button, 0, 1);
    },
    async drag(x0, y0, x1, y1, button = 'middle', steps = 8) {
      const b = { left: 1, right: 2, middle: 4 }[button];
      await mouse('mouseMoved', x0, y0);
      await mouse('mousePressed', x0, y0, button, b, 1);
      for (let i = 1; i <= steps; i++) {
        await mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, button, b);
        await sleep(20);
      }
      await mouse('mouseReleased', x1, y1, button, 0, 1);
    },
    async wheel(x, y, deltaY) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); },
    async key(code, key = code, text) {
      const vk = { Enter: 13, Escape: 27, Space: 32, Home: 36, PageUp: 33, PageDown: 34 }[code] ?? (/^Digit(\d)$/.test(code) ? 48 + Number(code.slice(5)) : /^Key([A-Z])$/.test(code) ? code.charCodeAt(3) : 0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
      await sleep(30);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
    },
    close() { try { ws.close(); } catch { /* */ } chrome.kill(); },
  };
  return api;
}
