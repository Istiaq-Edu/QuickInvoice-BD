begin;

create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 2_000),
  default_unit_price bigint not null default 0 check (default_unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index saved_items_workspace_updated_idx
  on public.saved_items (workspace_id, updated_at desc)
  where deleted_at is null;

create index saved_items_workspace_description_idx
  on public.saved_items (workspace_id, lower(description))
  where deleted_at is null;

create table public.note_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 10_000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index note_templates_workspace_updated_idx
  on public.note_templates (workspace_id, updated_at desc)
  where deleted_at is null;

create index note_templates_workspace_title_idx
  on public.note_templates (workspace_id, lower(title))
  where deleted_at is null;

alter table public.saved_items enable row level security;
alter table public.note_templates enable row level security;

create policy "workspace members manage saved items"
  on public.saved_items
  for all
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

create policy "workspace members manage note templates"
  on public.note_templates
  for all
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

revoke all on table public.saved_items from anon;
revoke all on table public.note_templates from anon;
grant select, insert, update, delete on table public.saved_items to authenticated;
grant select, insert, update, delete on table public.note_templates to authenticated;

commit;
