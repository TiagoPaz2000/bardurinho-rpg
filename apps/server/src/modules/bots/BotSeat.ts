/**
 * Fase 5: bot como assento da partida (seção 13). Recebe as mesmas notificações que um
 * jogador; na sua vez, decide com a **visão da sua equipe** (`session.projection(team)`, a
 * mesma projeção enviada a um cliente — sem posições ocultas nem semente dos dados) e envia o
 * comando por `session.submit`, ou seja, pela mesma fila e validação dos jogadores
 * (formato, `commandId`, autorização, core sem debug). Comando recusado: o bot não o repete no
 * turno; se nem encerrar o turno for aceito, o cronômetro do servidor encerra.
 */
import { BotBrain } from '@bardurinho/ai';
import { PROTOCOL_VERSION } from '@bardurinho/protocol';
import { randomUUID } from 'node:crypto';
import type { MatchSession } from '../matches/MatchSession.js';

export interface BotSeatOptions {
  /** Pausa entre comandos (ms) — dá tempo de o jogador ver as animações. */
  delayMs: number;
  log?: (msg: string) => void;
}

export class BotSeat {
  private thinking = false;
  private disposed = false;
  private wake = false;

  constructor(
    private readonly session: MatchSession,
    readonly seat: number,
    readonly brain: BotBrain,
    private readonly o: BotSeatOptions,
  ) {}

  private get team(): string {
    return this.session.seats[this.seat]!.team;
  }

  private myTurn(): boolean {
    const s = this.session.state;
    if (s.status !== 'active' || !s.turn.activeUnitId) return false;
    return s.units[s.turn.activeUnitId]?.team === this.team;
  }

  /** Mensagem para o assento do bot (snapshot/update): se for a vez dele, pensa. */
  notify(): void {
    if (this.disposed) return;
    if (this.thinking) {
      this.wake = true;
      return;
    }
    if (this.myTurn()) void this.play();
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async play(): Promise<void> {
    this.thinking = true;
    try {
      let guard = 0;
      while (!this.disposed && this.myTurn() && guard++ < 40) {
        await this.sleep(this.o.delayMs);
        if (this.disposed || !this.myTurn()) break;
        const view = this.session.projection(this.team).state;
        const decision = this.brain.decide(view);
        const r = await this.session.submit(this.seat, { ...decision.command, protocolVersion: PROTOCOL_VERSION, commandId: `bot:${randomUUID()}` });
        if (!r.ok) {
          this.o.log?.(`[bot ${this.brain.difficulty}] comando recusado (${r.error.code}): ${decision.label}`);
          this.brain.rejectedCommand(decision.command);
          if (decision.command.type === 'END_TURN') break;
        }
      }
    } catch (err) {
      this.o.log?.(`[bot] falha: ${String(err)}`);
    } finally {
      this.thinking = false;
      if (this.wake) {
        this.wake = false;
        this.notify();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
