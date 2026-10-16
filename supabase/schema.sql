BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  salt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_lowercase CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON public.app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON public.app_sessions(expires_at);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_users, public.app_sessions FROM anon, authenticated;

COMMIT;