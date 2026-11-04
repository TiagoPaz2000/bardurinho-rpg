/**
 * Fase 6: limite de tentativas (janela fixa por chave, em memória). Usado no login (falhas por
 * usuário, tentativas por IP) e no cadastro (por IP). Um processo só (MVP local); com vários
 * processos seria preciso um armazenamento comum.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    /** Máximo por janela (0 = sem limite). */
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private entry(key: string) {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || t - e.start >= this.windowMs) {
      e = { start: t, count: 0 };
      this.hits.set(key, e);
    }
    // Limpeza preguiçosa para o mapa não crescer sem fim.
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
    return e;
  }

  /** Já passou do limite? (não conta) */
  blocked(key: string): boolean {
    return this.max > 0 && this.entry(key).count >= this.max;
  }

  /** Conta uma ocorrência; devolve `false` se passou do limite. */
  hit(key: string): boolean {
    if (this.max <= 0) return true;
    const e = this.entry(key);
    e.count++;
    return e.count <= this.max;
  }

  /** Segundos até a janela da chave reabrir. */
  retryAfter(key: string): number {
    const e = this.hits.get(key);
    return e ? Math.max(1, Math.ceil((e.start + this.windowMs - this.now()) / 1000)) : 1;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
