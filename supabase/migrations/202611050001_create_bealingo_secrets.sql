create table if not exists public.bealingo_secrets (
  key text primary key,
  encrypted_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.bealingo_secrets enable row level security;

revoke all on table public.bealingo_secrets from anon, authenticated;

create or replace function public.set_bealingo_secret_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bealingo_secrets_updated_at on public.bealingo_secrets;
create trigger bealingo_secrets_updated_at
before update on public.bealingo_secrets
for each row execute function public.set_bealingo_secret_updated_at();
