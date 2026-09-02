-- One explicitly designated workspace may accept every authenticated DRMS
-- user as an operational agent. This is deliberately not public access:
-- auth is still mandatory, and owner/admin-only configuration remains role
-- protected. There can be only one such workspace per deployment.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_open_coordination_workspace BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_open_coordination_workspace
  ON public.accounts ((is_open_coordination_workspace))
  WHERE is_open_coordination_workspace;

-- New signups join the open workspace as agents when one has been explicitly
-- designated. Without that designation, retain the existing personal-account
-- bootstrap for fresh installs and ordinary private deployments.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE is_open_coordination_workspace
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (name, owner_user_id)
    VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
    RETURNING id INTO v_account_id;

    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');
  ELSE
    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'agent');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Existing users are moved automatically only when their current account is
-- the exact disposable six-stage bootstrap workspace already proven safe by
-- migrations 054–055. Accounts containing any operational or configuration
-- data are intentionally left unchanged rather than being silently orphaned.
CREATE OR REPLACE FUNCTION public.auto_join_open_coordination_workspace()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_open_account_id UUID;
  v_old_account_id UUID;
  v_old_account_owner UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_open_account_id
  FROM public.accounts
  WHERE is_open_coordination_workspace
  LIMIT 1;

  IF v_open_account_id IS NULL THEN
    RETURN jsonb_build_object('joined', FALSE, 'reason', 'not_configured');
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM public.profiles p
  JOIN public.accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p;

  IF v_old_account_id IS NULL THEN
    RETURN jsonb_build_object('joined', FALSE, 'reason', 'no_account');
  END IF;
  IF v_old_account_id = v_open_account_id THEN
    RETURN jsonb_build_object('joined', FALSE, 'reason', 'already_joined');
  END IF;
  IF v_old_account_owner <> v_caller_id
    OR NOT public.is_empty_disaster_bootstrap_account(v_old_account_id, v_caller_id) THEN
    RETURN jsonb_build_object('joined', FALSE, 'reason', 'private_account_has_data');
  END IF;

  UPDATE public.profiles
  SET account_id = v_open_account_id, account_role = 'agent'
  WHERE user_id = v_caller_id;

  DELETE FROM public.accounts WHERE id = v_old_account_id;

  RETURN jsonb_build_object('joined', TRUE, 'account_id', v_open_account_id);
END;
$$;

ALTER FUNCTION public.auto_join_open_coordination_workspace() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auto_join_open_coordination_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_join_open_coordination_workspace() TO authenticated;
