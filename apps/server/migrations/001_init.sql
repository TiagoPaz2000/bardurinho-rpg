-- Fase 3: contas, sessões, partidas, comandos, eventos, snapshots e resultados (seção 10.2).
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE matches (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL,
  map_id           TEXT NOT NULL,
  rules_version    INTEGER NOT NULL,
  content_version  TEXT NOT NULL,
  seed             INTEGER NOT NULL,
  turn_seconds     REAL NOT NULL,
  status           TEXT NOT NULL,
  result           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);

CREATE TABLE match_players (
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat        INTEGER NOT NULL,
  team        TEXT NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, account_id)
);

-- Registro de comandos: aceitos e recusados (auditoria). O commandId é único por partida:
-- a proteção contra repetição também vale no banco.
CREATE TABLE match_commands (
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  command_id    TEXT NOT NULL,
  author_kind   TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  seat          INTEGER,
  turn_id       INTEGER NOT NULL,
  payload       JSONB NOT NULL,
  accepted      BOOLEAN NOT NULL,
  error         JSONB,
  version_after INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq),
  UNIQUE (match_id, command_id)
);

-- Registro de eventos oficiais (sem filtro de visão).
CREATE TABLE match_events (
  match_id     TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  version      INTEGER NOT NULL,
  type         TEXT NOT NULL,
  event        JSONB NOT NULL,
  PRIMARY KEY (match_id, seq)
);

-- Snapshots do estado oficial: um por versão (cada comando aceito salva o novo estado).
CREATE TABLE match_snapshots (
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  state       JSONB NOT NULL,
  state_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, version)
);

CREATE TABLE match_results (
  match_id     TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  result       JSONB NOT NULL,
  winner_team  TEXT,
  rounds       INTEGER NOT NULL,
  turns        INTEGER NOT NULL,
  commands     INTEGER NOT NULL,
  final_hash   TEXT NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX match_events_version ON match_events (match_id, version);
