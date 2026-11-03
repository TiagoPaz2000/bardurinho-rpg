/**
 * Controlador da partida local (Fase 2): guarda o `GameState` oficial e aplica comandos
 * pelo core (`applyCommand`, regras normais, sem opções de debug). O cliente nunca
 * altera o estado por conta própria — só envia intenções e apresenta o resultado.
 *
 * Fluxo de um comando:
 *   execute(cmd) → applyCommand → rejeitado: presenter.rejected(erro)
 *                               → aceito:    presenter.play(eventos) (animação)
 *                                            → presenter.sync(estado) → ouvintes
 * Enquanto a animação toca, `busy` fica ligado e novos comandos são ignorados.
 */
import { applyCommand, type Catalog, type CommandError, type GameEvent, type GameplayCommand, type GameState, type Unit } from '@bardurinho/domain';

export interface MatchPresenter {
  /** Anima os eventos do comando; resolve quando a cena pode ser sincronizada. */
  play(events: readonly GameEvent[], before: GameState, after: GameState): Promise<void>;
  /** Sincroniza cena e HUD com o estado oficial. */
  sync(state: GameState): void;
  /** Comando recusado pelo core (mensagem para o jogador). */
  rejected(error: CommandError, command: GameplayCommand): void;
}

export interface MatchChange {
  command: GameplayCommand;
  events: readonly GameEvent[];
  before: GameState;
  state: GameState;
}

export type ExecuteResult = { ok: true; events: readonly GameEvent[] } | { ok: false; error: CommandError | { code: 'BUSY'; message: string } };

export class MatchController {
  private current: GameState;
  private shown: GameState;
  private events: readonly GameEvent[] = [];
  private readonly log: GameEvent[] = [];
  private playing = false;
  private readonly listeners = new Set<(change: MatchChange) => void>();
  presenter: MatchPresenter | null = null;

  constructor(
    readonly catalog: Catalog,
    initial: GameState,
  ) {
    this.current = initial;
    this.shown = initial;
  }

  /** Estado oficial (já inclui o último comando, mesmo durante a animação). */
  get state(): GameState {
    return this.current;
  }

  /**
   * Estado que a cena está mostrando: durante a animação continua o anterior ao comando,
   * para o HUD não adiantar PV/PM antes de o personagem chegar.
   */
  get displayedState(): GameState {
    return this.shown;
  }

  /** Eventos do último comando aceito. */
  get lastEvents(): readonly GameEvent[] {
    return this.events;
  }

  /** Todos os eventos aceitos desde o início (resumo da tela de resultado). */
  get history(): readonly GameEvent[] {
    return this.log;
  }

  /** Animação em andamento: comandos novos são ignorados. */
  get busy(): boolean {
    return this.playing;
  }

  get activeUnit(): Unit | undefined {
    const id = this.current.turn.activeUnitId;
    return id ? this.current.units[id] : undefined;
  }

  onChange(fn: (change: MatchChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Envia um comando ao core. Resolve depois da animação (ou na hora, se recusado). */
  async execute(command: GameplayCommand): Promise<ExecuteResult> {
    if (this.playing) return { ok: false, error: { code: 'BUSY', message: 'Aguarde a animação terminar' } };
    const before = this.current;
    const r = applyCommand(before, this.catalog, command, {});
    if (!r.ok) {
      this.presenter?.rejected(r.error, command);
      return { ok: false, error: r.error };
    }
    this.current = r.state;
    this.events = r.events;
    this.log.push(...r.events);
    this.playing = true;
    try {
      await this.presenter?.play(r.events, before, r.state);
    } catch (err) {
      console.error('Falha na animação dos eventos:', err);
    } finally {
      this.playing = false;
    }
    this.shown = r.state;
    this.presenter?.sync(r.state);
    const change: MatchChange = { command, events: r.events, before, state: r.state };
    for (const fn of this.listeners) fn(change);
    return { ok: true, events: r.events };
  }
}
