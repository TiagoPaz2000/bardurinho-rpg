/**
 * Fase 7: painel e API de administração do teste externo (só com `ADMIN_TOKEN`).
 *
 *   GET  /admin                              página do painel (pede o token; os dados vêm da API)
 *   GET  /admin/api/metrics?since=&until=    métricas (JSON)
 *   GET  /admin/api/report.md | report.html  relatório completo (o mesmo do `npm run metrics:report`)
 *   GET  /admin/api/invites                  códigos de convite
 *   POST /admin/api/invites                  { count, maxUses, label, prefix } → novos códigos
 *   POST /admin/api/invites/:code/disable    desativa um código
 *   GET  /admin/api/bugs                     relatórios de bug (sem o anexo)
 *   GET  /admin/api/bugs/:id/export          anexo da partida (bardurinho.bug-report/1) → Combat Debug Lab
 *   GET  /admin/api/surveys.csv              pesquisas (anônimas) em CSV
 *
 * Autenticação: `Authorization: Bearer <ADMIN_TOKEN>` (comparação em tempo constante). Sem
 * token configurado as rotas não existem (404). O painel não usa cookies.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Application, NextFunction, Request, Response } from 'express';
import { REPORT_CSS, computePlaytestMetrics, renderHtml, renderHtmlFragment, renderMarkdown } from './modules/analytics/playtestMetrics.js';
import type { ServerServices } from './services.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function registerAdminRoutes(app: Application, svc: ServerServices): void {
  const token = svc.config.adminToken;
  if (!token) return;
  const expected = digest(token);
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? '';
    const given = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!given || !timingSafeEqual(digest(given), expected)) return void res.status(401).json({ error: 'Token de administração inválido' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const metricsOf = (req: Request, label: string | null = null) =>
    computePlaytestMetrics(svc.db, svc.catalog, { since: parseDate(req.query.since), until: parseDate(req.query.until), label: label ?? (typeof req.query.label === 'string' ? req.query.label.slice(0, 120) : null) });
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      svc.log(`[admin] ${req.method} ${req.path}: ${String(err)}`);
      if (!res.headersSent) res.status(500).json({ error: 'Erro interno' });
    }
  };

  app.get('/admin', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ADMIN_PAGE);
  });
  app.get('/admin/api/metrics', guard, wrap((req) => metricsOf(req)));
  app.get('/admin/api/report.md', guard, wrap(async (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(renderMarkdown(await metricsOf(req)));
  }));
  app.get('/admin/api/report.html', guard, wrap(async (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const m = await metricsOf(req);
    res.send(req.query.fragment === '1' ? renderHtmlFragment(m) : renderHtml(m));
  }));
  app.get('/admin/api/invites', guard, wrap(() => svc.playtest.invites()));
  app.post('/admin/api/invites', guard, wrap(async (req) => {
    const b = (await readBody(req)) as Record<string, unknown>;
    const count = Math.max(1, Math.min(200, Number(b.count) || 1));
    const maxUses = Math.max(1, Math.min(1000, Number(b.maxUses) || 1));
    const label = typeof b.label === 'string' ? b.label.slice(0, 60) : null;
    const prefix = typeof b.prefix === 'string' && /^[A-Z0-9]{2,8}$/i.test(b.prefix) ? b.prefix.toUpperCase() : undefined;
    const codes = await svc.playtest.createInvites(count, maxUses, label, prefix);
    svc.log(`[admin] ${codes.length} código(s) de convite criados (${maxUses} uso(s) cada)`);
    return { codes };
  }));
  app.post('/admin/api/invites/:code/disable', guard, wrap(async (req, res) => {
    if (!(await svc.playtest.disableInvite(String(req.params.code)))) return void res.status(404).json({ error: 'Código não encontrado' });
    return { ok: true };
  }));
  app.get('/admin/api/bugs', guard, wrap(() => svc.playtest.bugs()));
  app.get('/admin/api/bugs/:id/export', guard, wrap(async (req, res) => {
    const bug = await svc.playtest.bug(String(req.params.id));
    if (!bug) return void res.status(404).json({ error: 'Relatório não encontrado' });
    if (!bug.report) return void res.status(404).json({ error: 'Sem relatório de partida anexado' });
    res.setHeader('Content-Disposition', `attachment; filename="bug-${bug.id.slice(0, 8)}.bug.json"`);
    res.json(bug.report);
  }));
  app.get('/admin/api/surveys.csv', guard, wrap(async (_req, res) => {
    const rows = await svc.db.query<Record<string, unknown>>(
      'SELECT created_at, match_id, analytics_id, mode, bot_difficulty, outcome, class_id, fun, clarity, camera, balance, bot_rating, play_again, comment, build FROM feedback_surveys ORDER BY created_at',
    );
    const cols = ['created_at', 'match_id', 'analytics_id', 'mode', 'bot_difficulty', 'outcome', 'class_id', 'fun', 'clarity', 'camera', 'balance', 'bot_rating', 'play_again', 'comment', 'build'];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pesquisas.csv"');
    res.send([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'));
  }));
}

function readBody(req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      raw += c;
      if (raw.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** Página do painel: só HTML/JS estático; tudo vem da API com o token (guardado na aba). */
const ADMIN_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Painel do teste — Bardurinho RPG</title>
<style>${REPORT_CSS}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.bar input{padding:4px 6px}.bar button{padding:5px 10px;cursor:pointer}
#err{color:#b00020}#codes{font-family:monospace;white-space:pre;background:#fff;border:1px solid #ddd;padding:6px;display:none}</style></head>
<body><h1>Painel do teste externo (Fase 7)</h1>
<div class="bar" id="login"><label>Token de administração <input id="tok" type="password" size="32" autocomplete="off"></label><button id="go">Entrar</button><span id="err"></span></div>
<div id="panel" hidden>
  <div class="bar"><label>De <input id="since" type="date"></label><label>até <input id="until" type="date"></label><button id="reload">Atualizar</button>
  <button id="md">Baixar .md</button><button id="html">Baixar .html</button><button id="csv">Pesquisas .csv</button><button id="out">Sair</button></div>
  <div class="bar"><b>Convites</b><label>quantidade <input id="count" type="number" value="5" min="1" max="200" style="width:60px"></label>
  <label>usos cada <input id="uses" type="number" value="1" min="1" style="width:60px"></label><label>rótulo <input id="label" placeholder="ex.: grupo 1"></label><button id="mk">Gerar códigos</button><button id="list">Ver códigos</button></div>
  <div id="codes"></div>
  <div id="bugs"></div>
  <div id="report">Carregando…</div>
</div>
<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('bardurinho.admin') || '';
const q = () => { const p = new URLSearchParams(); if ($('since').value) p.set('since', $('since').value); if ($('until').value) p.set('until', $('until').value + 'T23:59:59Z'); return p.toString(); };
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  if (r.status === 401) { sessionStorage.removeItem('bardurinho.admin'); $('panel').hidden = true; $('login').hidden = false; $('err').textContent = 'Token inválido'; throw new Error('401'); }
  return r;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
async function load() {
  $('report').innerHTML = (await (await api('/admin/api/report.html?fragment=1&' + q())).text());
  const bugs = await (await api('/admin/api/bugs')).json();
  $('bugs').innerHTML = bugs.length ? '<h2>Bugs reportados (anexos)</h2><table><thead><tr><th>Quando</th><th>Categoria</th><th>Descrição</th><th>Partida</th></tr></thead><tbody>' + bugs.map((b) => '<tr><td>' + esc(b.createdAt.slice(0, 16)) + '</td><td>' + esc(b.category) + '</td><td>' + esc(b.description) + '</td><td>' + (b.hasReport ? '<a href="#" data-bug="' + esc(b.id) + '">baixar relatório da partida</a>' : '—') + '</td></tr>').join('') + '</tbody></table>' : '';
}
async function download(path, name) {
  const blob = await (await api(path)).blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function enter() {
  try { await api('/admin/api/invites'); } catch { return; }
  sessionStorage.setItem('bardurinho.admin', token); $('login').hidden = true; $('panel').hidden = false; $('err').textContent = ''; await load();
}
$('go').onclick = () => { token = $('tok').value.trim(); enter(); };
$('tok').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('reload').onclick = load;
$('md').onclick = () => download('/admin/api/report.md?' + q(), 'relatorio-playtest.md');
$('html').onclick = () => download('/admin/api/report.html?' + q(), 'relatorio-playtest.html');
$('csv').onclick = () => download('/admin/api/surveys.csv', 'pesquisas.csv');
$('out').onclick = () => { sessionStorage.removeItem('bardurinho.admin'); location.reload(); };
$('mk').onclick = async () => { const r = await (await api('/admin/api/invites', { method: 'POST', body: JSON.stringify({ count: +$('count').value, maxUses: +$('uses').value, label: $('label').value }) })).json(); $('codes').style.display = 'block'; $('codes').textContent = 'Novos códigos:\\n' + r.codes.join('\\n'); };
$('list').onclick = async () => { const r = await (await api('/admin/api/invites')).json(); $('codes').style.display = 'block'; $('codes').textContent = r.map((c) => c.code + '  ' + c.uses + '/' + c.maxUses + (c.disabled ? '  (desativado)' : '') + (c.label ? '  ' + c.label : '')).join('\\n') || '(nenhum)'; };
document.addEventListener('click', (e) => { const id = e.target.dataset && e.target.dataset.bug; if (id) { e.preventDefault(); download('/admin/api/bugs/' + id + '/export', 'bug-' + id.slice(0, 8) + '.bug.json'); } });
if (token) enter();
</script></body></html>`;
