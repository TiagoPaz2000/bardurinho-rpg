/**
 * Fase 5: regras de perfil e progressão no servidor (o cliente só pede; tudo é validado aqui).
 *
 * - Personagem: nome (3–16), classe do catálogo, aparência só com cosméticos gratuitos ou do
 *   inventário, acessório e até dois consumíveis de tipos diferentes (`normalizeChoice`).
 * - Loja: produto existente e à venda, preço do catálogo (nunca do cliente), saldo suficiente,
 *   não possuído; idempotente pelo `requestId` do cliente.
 * - Recompensa de partida (`settleMatch`): calculada do **resultado oficial** (estado final +
 *   eventos persistidos), uma vez por (partida, conta) — repetir não credita de novo. Atualiza
 *   missões (permanentes e diárias) e concede as recompensas das concluídas.
 */
import {
  MAX_CHARACTERS_PER_ACCOUNT,
  appearanceProblem,
  characterNameProblem,
  cosmeticsById,
  matchCoins,
  missionIncrement,
  missionPeriod,
  missions,
  normalizeAppearance,
  normalizeChoice,
  participantStats,
  shopProducts,
  type MatchMode,
} from '@bardurinho/content';
import type { Catalog, GameEvent, GameState } from '@bardurinho/domain';
import type { CharacterDto, MatchRewardDto, MissionChangeDto, MissionDto, ShopItemDto } from '@bardurinho/protocol';
import type { Database } from '../../db/database.js';
import type { ProfileRepository } from '../../db/profile.js';

export class ProgressionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const cosmeticName = (id: string | undefined) => (id ? cosmeticsById[id]?.name : undefined);

export class ProgressionService {
  constructor(
    private readonly db: Database,
    private readonly profiles: ProfileRepository,
    private readonly catalog: Catalog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // --- Personagem -------------------------------------------------------------------

  async createCharacter(accountId: string, raw: Record<string, unknown>): Promise<CharacterDto> {
    const nameProblem = characterNameProblem(raw.name);
    if (nameProblem) throw new ProgressionError(nameProblem);
    const classId = typeof raw.classId === 'string' ? raw.classId : '';
    if (!this.catalog.classes[classId]) throw new ProgressionError('Escolha uma classe');
    const owned = await this.profiles.inventory(accountId);
    if (raw.appearance !== undefined) {
      const p = appearanceProblem(raw.appearance, owned);
      if (p) throw new ProgressionError(p);
    }
    const choice = normalizeChoice(this.catalog, { classId, accessoryId: raw.accessoryId as string | null, consumables: raw.consumables as string[] }, classId);
    const r = await this.profiles.createCharacter(
      accountId,
      { name: String(raw.name), classId, appearance: normalizeAppearance(raw.appearance, owned), accessoryId: choice.accessoryId ?? null, consumables: choice.consumables ?? [] },
      MAX_CHARACTERS_PER_ACCOUNT,
    );
    if (r === 'duplicate') throw new ProgressionError('Você já tem um personagem com esse nome', 409);
    if (r === 'limit') throw new ProgressionError(`Limite de ${MAX_CHARACTERS_PER_ACCOUNT} personagens por conta`, 409);
    return r;
  }

  /** Equipar: aparência (cosméticos possuídos), acessório e consumíveis. Classe e nome não mudam. */
  async updateCharacter(accountId: string, id: string, raw: Record<string, unknown>): Promise<CharacterDto> {
    const current = await this.profiles.character(accountId, id);
    if (!current) throw new ProgressionError('Personagem não encontrado', 404);
    if ('classId' in raw || 'name' in raw) throw new ProgressionError('Nome e classe não podem ser alterados');
    const owned = await this.profiles.inventory(accountId);
    const appearance = raw.appearance === undefined ? current.appearance : { ...current.appearance, ...(raw.appearance as Record<string, string>) };
    const p = appearanceProblem(appearance, owned);
    if (p) throw new ProgressionError(p);
    const choice = normalizeChoice(
      this.catalog,
      {
        classId: current.classId,
        accessoryId: 'accessoryId' in raw ? (raw.accessoryId as string | null) : current.accessoryId,
        consumables: 'consumables' in raw ? (raw.consumables as string[]) : current.consumables,
      },
      current.classId,
    );
    if ('accessoryId' in raw && raw.accessoryId && !choice.accessoryId) throw new ProgressionError('Acessório inválido');
    const updated = await this.profiles.updateCharacter(accountId, id, { appearance: normalizeAppearance(appearance, owned), accessoryId: choice.accessoryId ?? null, consumables: choice.consumables ?? [] });
    return updated!;
  }

  // --- Loja ---------------------------------------------------------------------------

  async shop(accountId: string): Promise<ShopItemDto[]> {
    const owned = new Set(await this.profiles.inventory(accountId));
    return shopProducts().map((p) => ({ id: p.id, slot: p.slot, name: p.name, description: p.description, price: p.price!, owned: owned.has(p.id) }));
  }

  async buy(accountId: string, productId: unknown, requestId: unknown): Promise<{ ok: boolean; balance: number; duplicate: boolean; error?: string; productId: string }> {
    if (typeof requestId !== 'string' || !/^[\w-]{8,64}$/.test(requestId)) throw new ProgressionError('requestId inválido');
    const product = typeof productId === 'string' ? cosmeticsById[productId] : undefined;
    if (!product || product.price === null) throw new ProgressionError('Produto não está à venda', 404);
    const previous = await this.profiles.purchaseByRequest(accountId, requestId);
    if (previous) {
      const acc = await this.profiles.account(accountId);
      return { ok: previous.status === 'completed', balance: acc?.coins ?? 0, duplicate: true, productId: previous.productId, ...(previous.error ? { error: previous.error } : {}) };
    }
    let r: Awaited<ReturnType<ProfileRepository['buy']>>;
    try {
      r = await this.profiles.buy(accountId, requestId, product.id, product.price);
    } catch (err) {
      // Corrida com o mesmo requestId (PostgreSQL com várias conexões): vale o registro gravado.
      const again = await this.profiles.purchaseByRequest(accountId, requestId);
      if (!again) throw err;
      const acc = await this.profiles.account(accountId);
      return { ok: again.status === 'completed', balance: acc?.coins ?? 0, duplicate: true, productId: again.productId, ...(again.error ? { error: again.error } : {}) };
    }
    return { ok: r.ok, balance: r.balance, duplicate: !!r.duplicate, productId: product.id, ...(r.error ? { error: r.error } : {}) };
  }

  // --- Missões ------------------------------------------------------------------------

  async missions(accountId: string): Promise<MissionDto[]> {
    const now = this.now();
    const keys = missions.map((m) => ({ missionId: m.id, period: missionPeriod(m, now) }));
    const progress = await this.profiles.missionProgress(accountId, keys);
    return missions.map((m) => {
      const p = progress.get(`${m.id}|${missionPeriod(m, now)}`);
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        period: m.period,
        target: m.target,
        progress: Math.min(m.target, p?.progress ?? 0),
        completed: !!p?.completed,
        reward: { ...m.reward, ...(m.reward.cosmeticId ? { cosmeticName: cosmeticName(m.reward.cosmeticId) } : {}) },
      };
    });
  }

  // --- Recompensa de partida ------------------------------------------------------------

  /**
   * Fecha a partida para cada participante humano: moedas pela tabela (modo × resultado),
   * missões e recompensas das missões concluídas — tudo numa transação por conta, uma vez só.
   * Devolve a recompensa de cada conta (a já gravada, se a partida foi fechada antes).
   */
  async settleMatch(matchId: string, mode: MatchMode, finalState: GameState, events: readonly GameEvent[], participants: Array<{ accountId: string; team: string }>): Promise<Map<string, MatchRewardDto>> {
    const out = new Map<string, MatchRewardDto>();
    if (finalState.status !== 'finished' || !finalState.result) return out;
    const now = this.now();
    for (const p of participants) {
      const stats = participantStats(finalState, events, p.team);
      const coins = matchCoins(mode, stats.outcome, stats.surrendered);
      const dto = await this.db.transaction(async (tx) => {
        const fresh = await this.profiles.claimReward(tx, matchId, p.accountId, stats.outcome, coins, stats);
        if (!fresh) return null;
        let balance = (await this.profiles.account(p.accountId, tx))?.coins ?? 0;
        if (coins > 0) {
          const after = await this.profiles.moveCoins(tx, p.accountId, coins, 'match', matchId);
          if (typeof after === 'number') balance = after;
        }
        const changes: MissionChangeDto[] = [];
        const unlocked: string[] = [];
        let missionCoins = 0;
        // Partidas personalizadas (lobby de desenvolvimento) não contam para missões.
        if (mode !== 'custom') {
          const keys = missions.map((m) => ({ missionId: m.id, period: missionPeriod(m, now) }));
          const progress = await this.profiles.missionProgress(p.accountId, keys, tx);
          for (const m of missions) {
            const period = missionPeriod(m, now);
            const cur = progress.get(`${m.id}|${period}`) ?? { progress: 0, completed: false };
            const inc = missionIncrement(m, stats);
            if (cur.completed || inc <= 0) continue;
            const after = Math.min(m.target, cur.progress + inc);
            const completedNow = after >= m.target;
            await this.profiles.setMissionProgress(tx, p.accountId, m.id, period, after, completedNow);
            if (completedNow) {
              if (m.reward.coins) {
                const b = await this.profiles.moveCoins(tx, p.accountId, m.reward.coins, 'mission', `${m.id}:${period}`);
                if (typeof b === 'number') {
                  balance = b;
                  missionCoins += m.reward.coins;
                }
              }
              if (m.reward.cosmeticId && (await this.profiles.grantItem(tx, p.accountId, m.reward.cosmeticId, `mission:${m.id}`))) unlocked.push(m.reward.cosmeticId);
            }
            changes.push({
              id: m.id,
              name: m.name,
              before: cur.progress,
              after,
              target: m.target,
              completedNow,
              reward: { ...m.reward, ...(m.reward.cosmeticId ? { cosmeticName: cosmeticName(m.reward.cosmeticId) } : {}) },
            });
          }
        }
        const reward: MatchRewardDto = {
          matchId,
          mode,
          outcome: stats.outcome,
          coins,
          missionCoins,
          balance,
          stats: { damageDealt: stats.damageDealt, barrelsDetonated: stats.barrelsDetonated, rounds: stats.rounds, surrendered: stats.surrendered, completed: stats.completed },
          missions: changes,
          unlocked,
        };
        await this.profiles.saveRewardDetails(tx, matchId, p.accountId, reward);
        return reward;
      });
      const r = dto ?? (await this.profiles.reward(matchId, p.accountId));
      if (r) out.set(p.accountId, r);
    }
    return out;
  }
}
