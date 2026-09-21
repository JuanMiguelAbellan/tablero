CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE login_attempts (
  id    bigserial PRIMARY KEY,
  email text NOT NULL,
  at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), at);

CREATE TABLE boards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE board_members (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_members_user_idx ON board_members (user_id);

-- Ordering uses fractional indexing: each item stores a string key, and inserting between two items only needs a new key
-- between theirs — no other row is touched. The keys are compared byte-wise by the client library, so the database MUST
-- compare them byte-wise too: with the default collation (en_US.UTF-8) "a" < "B" and the order would silently differ.
CREATE TABLE columns (
  id         uuid PRIMARY KEY,
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position   text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, position)
);

CREATE TABLE cards (
  id          uuid PRIMARY KEY,
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id   uuid NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  position    text COLLATE "C" NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (column_id, position)
);
CREATE INDEX cards_board_idx ON cards (board_id);

-- The change log. Every mutation appends events here in the same transaction that changes the data, so a client can be
-- brought up to date from any point ("everything after seq N") — which is what makes reconnection lossless.
CREATE TABLE events (
  seq        bigserial PRIMARY KEY,
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type       text NOT NULL,
  payload    jsonb NOT NULL,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  op_id      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_board_seq_idx ON events (board_id, seq);

-- Idempotency: a client that never saw the response to an operation may resend it; the stored response is returned
-- instead of applying the change twice.
CREATE TABLE ops (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  op_id    text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (board_id, op_id)
);

CREATE TABLE invites (
  token_hash text PRIMARY KEY,
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
