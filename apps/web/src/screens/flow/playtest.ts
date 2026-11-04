/**
 * Fase 7 — telas do teste externo: privacidade/consentimento, pesquisa curta pós-partida e
 * "reportar bug". Sobreposições em HTML (mesmo estilo do ciclo); cada uma devolve uma Promise.
 */
import { BALANCE_LABELS, BOT_RATING_LABELS, BUG_CATEGORIES, type BugReportInput, type SurveyInput } from '@bardurinho/protocol';
import { BUILD_LABEL } from '../../build.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function overlay(root: HTMLElement, cls: string, screen: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `hud-lobby flow pt-overlay ${cls}`;
  el.dataset.overlay = screen;
  root.append(el);
  return el;
}

// ---------------------------------------------------------------------------
// Privacidade / consentimento
// ---------------------------------------------------------------------------

export const PRIVACY_TEXT = `
  <p>Este é um <b>teste fechado</b> do Bardurinho RPG. Para decidir se o jogo deve continuar, queremos entender como ele é jogado.</p>
  <p><b>Sempre registrado</b> (é o funcionamento do jogo): sua conta (usuário e senha protegida), personagens, partidas, jogadas e resultados — o servidor é a autoridade das partidas e guarda o histórico. As análises usam esses dados <b>agregados</b>, sem nomes.</p>
  <p><b>Só se você aceitar — telemetria do jogo:</b> telas vistas, quanto tempo leva cada turno, quantas vezes cancelou uma mira, usou a câmera ou teve uma ação recusada, se pediu revanche ou saiu no meio. Vai com um identificador aleatório deste navegador (não com seu usuário), só para o servidor deste teste. Nada do que você digita, nem seu IP, entra na telemetria.</p>
  <p><b>Voluntário:</b> a pesquisa depois da partida e o botão "reportar bug" (que anexa o registro da partida para reproduzirmos o problema).</p>
  <p>Você pode mudar de ideia quando quiser em "privacidade", no rodapé. Para apagar seus dados, peça a quem te convidou.</p>`;

export function showConsent(root: HTMLElement, current: 'yes' | 'no' | null): Promise<'yes' | 'no'> {
  const el = overlay(root, 'pt-consent', 'consent');
  document.body.dataset.flow = 'consent';
  el.innerHTML = `<div class="hud-panel flow-box" data-screen="consent">
    <div class="flow-title">Antes de jogar: privacidade</div>
    <div class="pt-text">${PRIVACY_TEXT}</div>
    ${current ? `<div class="sub">Sua escolha atual: <b>${current === 'yes' ? 'telemetria ligada' : 'sem telemetria'}</b>.</div>` : ''}
    <div class="flow-actions">
      <button type="button" class="hud-button" data-consent="yes">Aceitar e participar</button>
      <button type="button" class="hud-button opt-secondary" data-consent="no">Jogar sem telemetria</button>
    </div>
    <div class="sub">${esc(BUILD_LABEL)}</div>
  </div>`;
  return new Promise((resolve) => {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-consent]');
      if (!b) return;
      el.remove();
      resolve(b.dataset.consent === 'yes' ? 'yes' : 'no');
    });
  });
}

// ---------------------------------------------------------------------------
// Pesquisa pós-partida
// ---------------------------------------------------------------------------

export interface SurveyContext {
  matchId: string;
  vsBot: boolean;
  outcomeLabel: string;
  submit(input: SurveyInput): Promise<void>;
}

const scaleRow = (name: string, labels: string[], value: number | null, from = 1) =>
  `<div class="ms-row pt-scale" data-scale="${name}">${labels
    .map((l, i) => `<button type="button" class="ms-opt${value === i + from ? ' on' : ''}" data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${i + from}" title="${esc(l)}">${esc(l)}</button>`)
    .join('')}</div>`;

/** Pesquisa curta (≤ 30 s). Resolve com 'sent' ou 'skipped'. */
export function showSurvey(root: HTMLElement, ctx: SurveyContext): Promise<'sent' | 'skipped'> {
  const el = overlay(root, 'pt-survey', 'survey');
  const prevFlow = document.body.dataset.flow;
  document.body.dataset.flow = 'survey';
  const v: { fun: number | null; clarity: number | null; camera: number | null; balance: number | null; botRating: number | null; playAgain: string | null; comment: string } = {
    fun: null,
    clarity: null,
    camera: null,
    balance: null,
    botRating: null,
    playAgain: null,
    comment: '',
  };
  let error = '';
  let busy = false;
  const stars = ['1 — chato', '2', '3', '4', '5 — muito divertido'];
  const agree = ['1 — nada', '2', '3', '4', '5 — totalmente'];
  const draw = () => {
    el.innerHTML = `<div class="hud-panel flow-box" data-screen="survey">
      <div class="end-kicker">Partida: ${esc(ctx.outcomeLabel)}</div>
      <div class="flow-title">Como foi? <span class="sub">(30 segundos, opcional)</span></div>
      <div class="ms-label">Quão divertida foi a partida?</div>${scaleRow('fun', stars, v.fun)}
      <div class="ms-label">Entendi o que estava acontecendo (regras, efeitos, de quem era a vez)</div>${scaleRow('clarity', agree, v.clarity)}
      <div class="ms-label">A câmera me ajudou (não atrapalhou)</div>${scaleRow('camera', agree, v.camera)}
      <div class="ms-label">A partida pareceu justa?</div>${scaleRow('balance', ['-2', '-1', '0', '1', '2'].map((k) => BALANCE_LABELS[k]!), v.balance, -2)}
      ${ctx.vsBot ? `<div class="ms-label">Dificuldade do bot</div>${scaleRow('botRating', ['1', '2', '3', '4', '5'].map((k) => BOT_RATING_LABELS[k]!), v.botRating)}` : ''}
      <div class="ms-label">Jogaria de novo?</div>
      <div class="ms-row">${[
        ['sim', 'Sim'],
        ['talvez', 'Talvez'],
        ['nao', 'Não'],
      ]
        .map(([id, l]) => `<button type="button" class="ms-opt${v.playAgain === id ? ' on' : ''}" data-again="${id}">${l}</button>`)
        .join('')}</div>
      <label class="flow-field">Comentário (o que mais gostou, o que atrapalhou)<textarea name="comment" maxlength="500" rows="3" placeholder="opcional">${esc(v.comment)}</textarea></label>
      ${error ? `<div class="flow-msg error" data-msg>${esc(error)}</div>` : ''}
      <div class="flow-actions">
        <button type="button" class="hud-button" data-act="survey-send" ${busy || v.fun === null ? 'disabled' : ''}>Enviar</button>
        <button type="button" class="hud-button opt-secondary" data-act="survey-skip" ${busy ? 'disabled' : ''}>Pular</button>
      </div>
    </div>`;
  };
  draw();
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return new Promise((resolve) => {
    const done = (r: 'sent' | 'skipped') => {
      el.remove();
      document.body.dataset.flow = prevFlow ?? '';
      resolve(r);
    };
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLTextAreaElement;
      if (t.name === 'comment') v.comment = t.value;
    });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b || b.hasAttribute('disabled')) return;
      const d = b.dataset;
      for (const k of ['fun', 'clarity', 'camera', 'balance', 'botRating'] as const) {
        const raw = d[k];
        if (raw !== undefined) {
          v[k] = Number(raw);
          return draw();
        }
      }
      if (d.again) {
        v.playAgain = d.again;
        return draw();
      }
      if (d.act === 'survey-skip') return done('skipped');
      if (d.act === 'survey-send' && v.fun !== null) {
        busy = true;
        error = '';
        draw();
        try {
          await ctx.submit({
            matchId: ctx.matchId,
            fun: v.fun,
            clarity: v.clarity,
            camera: v.camera,
            balance: v.balance,
            botRating: ctx.vsBot ? v.botRating : null,
            playAgain: (v.playAgain as SurveyInput['playAgain']) ?? null,
            comment: v.comment.trim(),
            build: BUILD_LABEL,
          });
          done('sent');
        } catch (err) {
          busy = false;
          error = err instanceof Error ? err.message : String(err);
          draw();
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Reportar bug
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<string, string> = { interface: 'Interface', camera: 'Câmera', regras: 'Regras / habilidades', conexao: 'Conexão', desempenho: 'Desempenho', bot: 'Bot', outro: 'Outro' };

export function showBugReport(root: HTMLElement, ctx: { matchId: string | null; submit(input: BugReportInput): Promise<{ attached: boolean }> }): Promise<boolean> {
  const el = overlay(root, 'pt-bug', 'bug');
  const prevFlow = document.body.dataset.flow;
  document.body.dataset.flow = 'bug';
  let category: string = 'interface';
  let text = '';
  let msg = '';
  let busy = false;
  let sent = false;
  const draw = () => {
    el.innerHTML = `<div class="hud-panel flow-box" data-screen="bug">
      <div class="flow-title">Reportar um problema</div>
      ${
        sent
          ? `<div class="flow-msg info" data-bug-sent>${esc(msg)}</div><div class="flow-actions"><button type="button" class="hud-button" data-act="bug-close">Fechar</button></div>`
          : `<div class="sub">${ctx.matchId ? 'O registro desta partida (jogadas e estado oficial) vai junto para reproduzirmos o problema.' : 'Fora de uma partida: só a descrição é enviada.'}</div>
      <div class="ms-label">O que deu errado?</div>
      <div class="ms-row">${BUG_CATEGORIES.map((c) => `<button type="button" class="ms-opt${category === c ? ' on' : ''}" data-cat="${c}">${CATEGORY_LABEL[c] ?? c}</button>`).join('')}</div>
      <label class="flow-field">Descrição (o que você fez, o que esperava, o que aconteceu)<textarea name="bugText" maxlength="2000" rows="4">${esc(text)}</textarea></label>
      ${msg ? `<div class="flow-msg error" data-msg>${esc(msg)}</div>` : ''}
      <div class="flow-actions">
        <button type="button" class="hud-button" data-act="bug-send" ${busy || text.trim().length < 3 ? 'disabled' : ''}>Enviar relatório</button>
        <button type="button" class="hud-button opt-secondary" data-act="bug-close" ${busy ? 'disabled' : ''}>Cancelar</button>
      </div>`
      }
    </div>`;
    const ta = el.querySelector<HTMLTextAreaElement>('textarea');
    if (ta && document.activeElement !== ta && !sent) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  };
  draw();
  // A partida continua recebendo teclas pelo `window`: o formulário não deixa o atalho vazar.
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return new Promise((resolve) => {
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLTextAreaElement;
      if (t.name !== 'bugText') return;
      const enable = (text.trim().length >= 3) !== (t.value.trim().length >= 3);
      text = t.value;
      if (enable) {
        const btn = el.querySelector<HTMLButtonElement>('[data-act="bug-send"]');
        if (btn) btn.disabled = text.trim().length < 3;
      }
    });
    el.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b || b.hasAttribute('disabled')) return;
      if (b.dataset.cat) {
        category = b.dataset.cat;
        return draw();
      }
      if (b.dataset.act === 'bug-close') {
        el.remove();
        document.body.dataset.flow = prevFlow ?? '';
        return resolve(sent);
      }
      if (b.dataset.act === 'bug-send') {
        busy = true;
        msg = '';
        draw();
        try {
          const r = await ctx.submit({
            matchId: ctx.matchId,
            category: category as BugReportInput['category'],
            description: text.trim(),
            client: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1, ua: navigator.userAgent.slice(0, 64) },
            build: BUILD_LABEL,
          });
          sent = true;
          msg = r.attached ? 'Obrigado! Relatório enviado com o registro da partida.' : 'Obrigado! Relatório enviado.';
        } catch (err) {
          msg = err instanceof Error ? err.message : String(err);
        }
        busy = false;
        draw();
      }
    });
  });
}
