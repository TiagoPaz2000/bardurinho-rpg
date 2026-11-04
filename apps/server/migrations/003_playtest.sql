-- Fase 7: teste externo do MVP — códigos de convite (grupo controlado), revanche, telemetria
-- opcional do cliente (com consentimento), pesquisa pós-partida e relatórios de bug.
--
-- Anonimização: as tabelas de análise nunca guardam usuário, nome, IP nem token; o jogador
-- aparece só pelo `analytics_id` (aleatório, sem relação com o id da conta fora desta tabela).

-- Contas: id anônimo para análise, código de convite usado no cadastro e decisão sobre a
-- telemetria (null = ainda não respondeu).
ALTER TABLE accounts ADD COLUMN analytics_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE accounts ADD COLUMN invite_code TEXT;
ALTER TABLE accounts ADD COLUMN telemetry_consent BOOLEAN;
ALTER TABLE accounts ADD COLUMN telemetry_consent_at TIMESTAMPTZ;
CREATE UNIQUE INDEX accounts_analytics_id ON accounts (analytics_id);

-- Revanche: a partida nova aponta para a anterior.
ALTER TABLE matches ADD COLUMN rematch_of TEXT;
CREATE INDEX matches_rematch_of ON matches (rematch_of);

-- Convites do grupo controlado: cada código aceita `max_uses` cadastros.
CREATE TABLE invite_codes (
  code        TEXT PRIMARY KEY,
  label       TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  disabled    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  CONSTRAINT invite_codes_uses CHECK (uses >= 0 AND uses <= max_uses)
);

-- Eventos leves do cliente (só com consentimento): sessão, telas, atritos de interface/câmera,
-- tempo por turno, revanche, abandono. `client_id` = id aleatório do navegador.
CREATE TABLE analytics_events (
  id            BIGSERIAL PRIMARY KEY,
  client_id     TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  analytics_id  TEXT,
  type          TEXT NOT NULL,
  match_id      TEXT,
  props         JSONB NOT NULL DEFAULT '{}'::jsonb,
  build         TEXT,
  client_ts     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_type ON analytics_events (type, created_at);
CREATE INDEX analytics_events_session ON analytics_events (session_id);

-- Pesquisa curta depois da partida (voluntária): uma por partida e jogador.
CREATE TABLE feedback_surveys (
  id              BIGSERIAL PRIMARY KEY,
  match_id        TEXT NOT NULL,
  analytics_id    TEXT NOT NULL,
  mode            TEXT,
  bot_difficulty  TEXT,
  outcome         TEXT,
  class_id        TEXT,
  fun             SMALLINT,
  clarity         SMALLINT,
  camera          SMALLINT,
  balance         SMALLINT,
  bot_rating      SMALLINT,
  play_again      TEXT,
  comment         TEXT,
  build           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, analytics_id)
);

-- "Reportar bug": descrição do jogador + relatório da partida (formato bardurinho.bug-report/1
-- da Fase 6, montado no servidor; nunca volta para o cliente).
CREATE TABLE bug_reports (
  id            TEXT PRIMARY KEY,
  analytics_id  TEXT,
  match_id      TEXT,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  client        JSONB NOT NULL DEFAULT '{}'::jsonb,
  report        JSONB,
  build         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retorno de jogadores (D1/D7): um registro por conta e dia (UTC) com atividade (abrir o jogo
-- logado, jogar). Gravado no GET /me (cada carregamento do cliente).
CREATE TABLE account_days (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, day)
);
