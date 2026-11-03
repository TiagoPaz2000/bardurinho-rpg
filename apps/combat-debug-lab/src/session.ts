/**
 * Sessão do laboratório: estado de preparação + lista de comandos.
 * Todo estado exibido é derivado executando os comandos no core (replay por comandos,
 * não por gravação). O laboratório nunca calcula regras.
 */
import {
  applyCommand,
  buildScenario,
  exportScenario,
  snapshotExpected,
  type Catalog,
  type Command,
  type CommandError,
  type ExecutionOptions,
  type GameEvent,
  type GameState,
  type ScenarioInitial,
} from '@bardurinho/domain';

export interface TimelineEntry {
  command: Command;
  options: ExecutionOptions;
  events: GameEvent[];
  /** Estado após o comando. */
  state: GameState;
  /** Estado antes do comando (para State Diff). */
  before: GameState;
  /** Estado logo após cada evento (STEP por evento). */
  snapshots: GameState[];
}

export class LabSession {
  setup: GameState;
  timeline: TimelineEntry[] = [];
  /** Quantos comandos da timeline estão aplicados (STEP/REPLAY). */
  cursor = 0;
  lastError: CommandError | null = null;

  constructor(private readonly catalog: Catalog, initial: ScenarioInitial) {
    this.setup = buildScenario(catalog, { ...initial, autoStart: false });
    this.execute({ type: 'START_MATCH' }, {});
  }

  get state(): GameState {
    return this.cursor === 0 ? this.setup : this.timeline[this.cursor - 1]!.state;
  }

  get visibleEvents(): GameEvent[] {
    return this.timeline.slice(0, this.cursor).flatMap((t) => t.events);
  }

  /** Executa um comando no estado atual. Descarta comandos "à frente" do cursor. */
  execute(command: Command, options: ExecutionOptions): boolean {
    const before = this.state;
    const r = applyCommand(before, this.catalog, command, { ...options, allowDebugCommands: true, captureEventSnapshots: true });
    if (!r.ok) {
      this.lastError = r.error;
      return false;
    }
    this.lastError = null;
    this.timeline = this.timeline.slice(0, this.cursor);
    this.timeline.push({ command, options, events: r.events, state: r.state, before, snapshots: r.snapshots ?? [] });
    this.cursor = this.timeline.length;
    return true;
  }

  /** EDIT: altera a preparação e reinicia a timeline. */
  editSetup(mutate: (setup: GameState) => void): void {
    const next = structuredClone(this.setup);
    mutate(next);
    this.setup = next;
    this.timeline = [];
    this.cursor = 0;
    this.execute({ type: 'START_MATCH' }, {});
  }

  /** Estado logo após o evento `seq` (entre os comandos aplicados). */
  snapshotAfterEvent(seq: number): GameState | null {
    for (const entry of this.timeline.slice(0, this.cursor)) {
      const i = entry.events.findIndex((e) => e.seq === seq);
      if (i >= 0) return entry.snapshots[i] ?? null;
    }
    return null;
  }

  stepBack(): void {
    if (this.cursor > 1) this.cursor--;
  }

  stepForward(): void {
    if (this.cursor < this.timeline.length) this.cursor++;
  }

  /** Reexecuta todos os comandos desde a preparação (verifica determinismo). */
  replay(): { identical: boolean } {
    const original = this.timeline.map((t) => JSON.stringify(t.state));
    let state = this.setup;
    let identical = true;
    this.timeline.forEach((t, i) => {
      const r = applyCommand(state, this.catalog, t.command, { ...t.options, allowDebugCommands: true });
      if (!r.ok) {
        identical = false;
        return;
      }
      if (JSON.stringify(r.state) !== original[i]) identical = false;
      state = r.state;
    });
    return { identical };
  }

  /** Arquivos do teste automatizado: initial.json, commands.json, expected.json. */
  exportTest(name: string): { initial: ScenarioInitial; commands: Command[]; expected: ReturnType<typeof snapshotExpected> } {
    const applied = this.timeline.slice(0, this.cursor);
    const commands = applied.map((t) => t.command).filter((c) => c.type !== 'START_MATCH');
    const events = applied.slice(1).flatMap((t) => t.events);
    return {
      initial: exportScenario(this.setup, name),
      commands,
      expected: snapshotExpected(this.state, events),
    };
  }
}
