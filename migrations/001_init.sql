-- KIRO via Evolution API — esquema inicial
-- Princípio: o banco é a fonte da verdade sobre o que aconteceu.
-- O modelo nunca é a prova de que algo foi gravado.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── conversas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel            TEXT        NOT NULL DEFAULT 'whatsapp',
  instance           TEXT        NOT NULL,
  remote_jid         TEXT        NOT NULL,
  sender_phone_hash  TEXT        NOT NULL,
  sender_role        TEXT        NOT NULL,       -- owner | spouse | clinic | unknown
  active_agent       TEXT        NOT NULL DEFAULT 'kiro',
  agent_sticky_until TIMESTAMPTZ,                -- MODO INJETAVEIS gruda ate aqui
  status             TEXT        NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance, remote_jid)
);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_hash ON conversations (sender_phone_hash);

-- ── mensagens ────────────────────────────────────────────────
-- external_message_id e a chave de idempotencia. O UNIQUE faz o trabalho:
-- insercao duplicada falha por constraint, nao por consulta-depois-insere
-- (que teria corrida entre dois webhooks simultaneos).
CREATE TABLE IF NOT EXISTS messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_message_id  TEXT        NOT NULL,
  conversation_id      UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction            TEXT        NOT NULL,     -- inbound | outbound
  type                 TEXT        NOT NULL,     -- text | audio | image | document
  text_redacted        TEXT,
  status               TEXT        NOT NULL DEFAULT 'received',
  agent_id             TEXT,
  model                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_message_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages (conversation_id, created_at DESC);

-- ── memoria ──────────────────────────────────────────────────
-- scope separa pessoal / clinica / legendarios. O codigo filtra por scope
-- ANTES de montar o contexto. O modelo nunca ve o que nao e do escopo dele.
CREATE TABLE IF NOT EXISTS memory_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT        NOT NULL,              -- profile | approved | clinic | legendarios
  agent_id    TEXT,
  content     TEXT        NOT NULL,
  source      TEXT        NOT NULL,
  approved    BOOLEAN     NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_scope_approved ON memory_items (scope, approved);

-- ── confirmacoes pendentes ───────────────────────────────────
-- Uma pendencia ativa por conversa. O indice parcial garante isso no banco,
-- nao na aplicacao.
CREATE TABLE IF NOT EXISTS pending_confirmations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id           TEXT        NOT NULL,
  tool_name          TEXT        NOT NULL,
  action             TEXT        NOT NULL,
  summary            TEXT        NOT NULL,       -- texto que foi mostrado ao humano
  payload_redacted   JSONB       NOT NULL,
  anchor_message_id  TEXT        NOT NULL,       -- mensagem a que o "sim" deve responder
  status             TEXT        NOT NULL DEFAULT 'pending',  -- pending|confirmed|rejected|expired|superseded
  expires_at         TIMESTAMPTZ NOT NULL,
  confirmed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_per_conversation
  ON pending_confirmations (conversation_id) WHERE status = 'pending';

-- ── auditoria ────────────────────────────────────────────────
-- Prova tecnica do que aconteceu. Nao depende do modelo.
CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT        NOT NULL,
  actor           TEXT        NOT NULL,          -- system | agent:<id> | human:<role>
  conversation_id UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  tool_name       TEXT,
  result          TEXT        NOT NULL,          -- ok | error | refused | awaiting_confirmation
  external_id     TEXT,                          -- id devolvido pela API externa
  error_code      TEXT,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events (event_type, created_at DESC);

-- ── estado de automacao ──────────────────────────────────────
-- A 6a tabela, ausente da spec original. Sem ela a regra de silencio
-- operacional nao funciona: o contador de "3 ciclos consecutivos" e o
-- cache de itens ja vistos precisam sobreviver entre execucoes de cron.
CREATE TABLE IF NOT EXISTS automation_state (
  key                  TEXT PRIMARY KEY,         -- ex: 'gmail_notify', 'agenda_manha'
  last_run_at          TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_alert_at        TIMESTAMPTZ,
  seen_ids             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  payload              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
