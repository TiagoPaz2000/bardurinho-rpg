-- Fase 5: ciclo completo — contas reais, personagens, inventário, moedas, loja, recompensas,
-- missões e histórico (seções 10.2 e 12).

-- Contas: tipo (jogador, desenvolvimento, bot), código de amigo (convites), saldo e personagem ativo.
ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'player';
ALTER TABLE accounts ADD COLUMN friend_code TEXT;
ALTER TABLE accounts ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN active_character_id TEXT;
ALTER TABLE accounts ADD CONSTRAINT accounts_coins_nonnegative CHECK (coins >= 0);
CREATE UNIQUE INDEX accounts_friend_code ON accounts (friend_code);

ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Personagens: classe, nome, aparência (cosméticos equipados) e escolha de combate (acessório + consumíveis).
CREATE TABLE characters (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  name_key     TEXT NOT NULL,
  class_id     TEXT NOT NULL,
  appearance   JSONB NOT NULL,
  accessory_id TEXT,
  consumables  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name_key)
);
CREATE INDEX characters_account ON characters (account_id);

-- Inventário: cosméticos desbloqueados (compra ou missão).
CREATE TABLE inventory (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id)
);

-- Economia: histórico de movimentações. (reason, ref) único por conta = idempotência
-- (a mesma recompensa de partida ou compra nunca entra duas vezes).
CREATE TABLE coin_ledger (
  id            BIGSERIAL PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  ref           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, reason, ref)
);

-- Compras: solicitação (request_id do cliente), produto, preço e resultado.
CREATE TABLE purchases (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id  TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  price       INTEGER NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id)
);

-- Partidas: modo (pvp, private, bot, custom) e dificuldade do bot.
ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE matches ADD COLUMN bot_difficulty TEXT;
ALTER TABLE match_players ADD COLUMN character_id TEXT;
ALTER TABLE match_players ADD COLUMN character JSONB;

-- Recompensa por participante: uma por (partida, conta) — idempotente.
CREATE TABLE match_rewards (
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  outcome     TEXT NOT NULL,
  coins       INTEGER NOT NULL,
  stats       JSONB NOT NULL,
  missions    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, account_id)
);
CREATE INDEX match_rewards_account ON match_rewards (account_id, created_at);

-- Missões: progresso por período (`perm` ou a data UTC das diárias).
CREATE TABLE mission_progress (
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mission_id    TEXT NOT NULL,
  period        TEXT NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  PRIMARY KEY (account_id, mission_id, period)
);
CREATE INDEX match_players_account ON match_players (account_id);
