-- 狗狗与咪咪的爱心日程表：正式双人云端版
-- 在 Supabase SQL Editor 中完整执行本文件，或通过 Supabase CLI 应用迁移。

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '新用户',
  avatar_emoji text not null default '♡',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('dog', 'cat')),
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  unique (couple_id, role),
  unique (user_id)
);

create table if not exists public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  record_date date not null,
  content text not null default '',
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, record_date)
);

create table if not exists public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  record_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  mood text not null,
  emoji text not null default '🙂',
  story text not null default '',
  happy text not null default '',
  upset text not null default '',
  need text not null default '',
  message text not null default '',
  visibility text not null default 'shared' check (visibility in ('shared', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, record_date, user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  task_date date not null,
  task_time time,
  title text not null check (char_length(title) between 1 and 100),
  note text not null default '',
  dog_done boolean not null default false,
  cat_done boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  record_date date not null,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 100),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  category text not null default '生活',
  owner_role text not null default 'both' check (owner_role in ('dog', 'cat', 'both')),
  note text not null default '',
  planned_date date,
  status smallint not null default 0 check (status between 0 and 3),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  memory_date date not null,
  title text not null check (char_length(title) between 1 and 120),
  note text not null default '',
  icon text not null default '♥',
  source_type text not null default 'manual' check (source_type in ('manual', 'task', 'wish', 'system')),
  source_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (couple_id, source_type, source_id)
);

create index if not exists idx_tasks_couple_date on public.tasks(couple_id, task_date);
create index if not exists idx_entries_couple_date on public.daily_entries(couple_id, record_date);
create index if not exists idx_responses_couple_date on public.responses(couple_id, record_date);
create index if not exists idx_memories_couple_date on public.memories(couple_id, memory_date desc);
create index if not exists idx_wishes_couple on public.wishes(couple_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, '新用户'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles(id, display_name)
select id, coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, '新用户'), '@', 1))
from auth.users
on conflict (id) do nothing;

create or replace function public.is_couple_member(target_couple uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target_couple and user_id = auth.uid()
  );
$$;

create or replace function public.shares_couple_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid() or exists (
    select 1
    from public.couple_members mine
    join public.couple_members theirs on theirs.couple_id = mine.couple_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user
  );
$$;

create or replace function public.current_couple_role(target_couple uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.couple_members
  where couple_id = target_couple and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.create_couple(p_name text, p_role text)
returns table(couple_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  new_code text;
  attempts integer := 0;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if p_role not in ('dog', 'cat') then raise exception '角色无效'; end if;
  if exists(select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception '你已经加入了一个双人空间';
  end if;

  loop
    attempts := attempts + 1;
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists(select 1 from public.couples where couples.invite_code = new_code);
    if attempts > 8 then raise exception '邀请码生成失败，请重试'; end if;
  end loop;

  insert into public.couples(name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), '我们的线上小窝'), new_code, auth.uid())
  returning id into new_id;

  insert into public.couple_members(couple_id, user_id, role)
  values (new_id, auth.uid(), p_role);

  update public.profiles
  set avatar_emoji = case when p_role = 'dog' then '🐶' else '🐱' end,
      updated_at = now()
  where id = auth.uid();

  insert into public.memories(couple_id, memory_date, title, note, icon, source_type, created_by)
  values (new_id, current_date, '建立了我们的线上小窝', '从今天开始，把共同计划、心情和想念保存下来。', '🏡', 'system', auth.uid());

  return query select new_id, new_code;
end;
$$;

create or replace function public.join_couple_by_code(p_invite_code text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if p_role not in ('dog', 'cat') then raise exception '角色无效'; end if;
  if exists(select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception '你已经加入了一个双人空间';
  end if;

  select id into target_id
  from public.couples
  where invite_code = upper(trim(p_invite_code));

  if target_id is null then raise exception '没有找到这个邀请码'; end if;
  if exists(select 1 from public.couple_members where couple_id = target_id and role = p_role) then
    raise exception '这个角色已经被对方选择，请选择另一个角色';
  end if;
  if (select count(*) from public.couple_members where couple_id = target_id) >= 2 then
    raise exception '这个双人空间已经有两位成员';
  end if;

  insert into public.couple_members(couple_id, user_id, role)
  values (target_id, auth.uid(), p_role);

  update public.profiles
  set avatar_emoji = case when p_role = 'dog' then '🐶' else '🐱' end,
      updated_at = now()
  where id = auth.uid();

  return target_id;
end;
$$;

create or replace function public.guard_task_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role text;
begin
  member_role := public.current_couple_role(old.couple_id);
  if member_role is null then raise exception '你不属于这个双人空间'; end if;
  if new.dog_done is distinct from old.dog_done and member_role <> 'dog' then
    raise exception '只能修改自己的完成状态';
  end if;
  if new.cat_done is distinct from old.cat_done and member_role <> 'cat' then
    raise exception '只能修改自己的完成状态';
  end if;
  return new;
end;
$$;

create or replace function public.sync_task_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dog_done and new.cat_done then
    insert into public.memories(couple_id, memory_date, title, note, icon, source_type, source_id, created_by)
    values (new.couple_id, new.task_date, '一起完成了「' || new.title || '」', coalesce(nullif(new.note, ''), '一件小事，被我们共同认真完成。'), '♥', 'task', new.id, new.created_by)
    on conflict (couple_id, source_type, source_id)
    do update set memory_date = excluded.memory_date, title = excluded.title, note = excluded.note;
  else
    delete from public.memories
    where couple_id = new.couple_id and source_type = 'task' and source_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.sync_wish_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 3 then
    insert into public.memories(couple_id, memory_date, title, note, icon, source_type, source_id, created_by)
    values (new.couple_id, coalesce(new.planned_date, current_date), '愿望成真：「' || new.title || '」', coalesce(nullif(new.note, ''), '我们把一个愿望变成了真实的回忆。'), '☆', 'wish', new.id, new.created_by)
    on conflict (couple_id, source_type, source_id)
    do update set memory_date = excluded.memory_date, title = excluded.title, note = excluded.note;
  else
    delete from public.memories
    where couple_id = new.couple_id and source_type = 'wish' and source_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists notes_updated_at on public.daily_notes;
create trigger notes_updated_at before update on public.daily_notes for each row execute procedure public.set_updated_at();
drop trigger if exists entries_updated_at on public.daily_entries;
create trigger entries_updated_at before update on public.daily_entries for each row execute procedure public.set_updated_at();
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at before update on public.tasks for each row execute procedure public.set_updated_at();
drop trigger if exists wishes_updated_at on public.wishes;
create trigger wishes_updated_at before update on public.wishes for each row execute procedure public.set_updated_at();

drop trigger if exists guard_task_role_update_trigger on public.tasks;
create trigger guard_task_role_update_trigger before update on public.tasks for each row execute procedure public.guard_task_role_update();
drop trigger if exists sync_task_memory_trigger on public.tasks;
create trigger sync_task_memory_trigger after insert or update on public.tasks for each row execute procedure public.sync_task_memory();
drop trigger if exists sync_wish_memory_trigger on public.wishes;
create trigger sync_wish_memory_trigger after insert or update on public.wishes for each row execute procedure public.sync_wish_memory();

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.daily_notes enable row level security;
alter table public.daily_entries enable row level security;
alter table public.tasks enable row level security;
alter table public.responses enable row level security;
alter table public.wishes enable row level security;
alter table public.memories enable row level security;

-- 重建策略，方便重复执行迁移文件。
drop policy if exists "profiles_select_shared" on public.profiles;
create policy "profiles_select_shared" on public.profiles for select to authenticated using (public.shares_couple_with(id));
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "couples_select_members" on public.couples;
create policy "couples_select_members" on public.couples for select to authenticated using (public.is_couple_member(id));
drop policy if exists "couples_update_members" on public.couples;
create policy "couples_update_members" on public.couples for update to authenticated using (public.is_couple_member(id)) with check (public.is_couple_member(id));

drop policy if exists "members_select_same_couple" on public.couple_members;
create policy "members_select_same_couple" on public.couple_members for select to authenticated using (user_id = auth.uid() or public.is_couple_member(couple_id));

-- 所有共享表：仅同一 couple_id 的成员可访问。
drop policy if exists "notes_select_members" on public.daily_notes;
create policy "notes_select_members" on public.daily_notes for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists "notes_insert_members" on public.daily_notes;
create policy "notes_insert_members" on public.daily_notes for insert to authenticated with check (public.is_couple_member(couple_id) and author_id = auth.uid());
drop policy if exists "notes_update_members" on public.daily_notes;
create policy "notes_update_members" on public.daily_notes for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
drop policy if exists "notes_delete_members" on public.daily_notes;
create policy "notes_delete_members" on public.daily_notes for delete to authenticated using (public.is_couple_member(couple_id));

drop policy if exists "entries_select_visibility" on public.daily_entries;
create policy "entries_select_visibility" on public.daily_entries for select to authenticated using (public.is_couple_member(couple_id) and (visibility = 'shared' or user_id = auth.uid()));
drop policy if exists "entries_insert_self" on public.daily_entries;
create policy "entries_insert_self" on public.daily_entries for insert to authenticated with check (public.is_couple_member(couple_id) and user_id = auth.uid());
drop policy if exists "entries_update_self" on public.daily_entries;
create policy "entries_update_self" on public.daily_entries for update to authenticated using (user_id = auth.uid() and public.is_couple_member(couple_id)) with check (user_id = auth.uid() and public.is_couple_member(couple_id));
drop policy if exists "entries_delete_self" on public.daily_entries;
create policy "entries_delete_self" on public.daily_entries for delete to authenticated using (user_id = auth.uid() and public.is_couple_member(couple_id));

drop policy if exists "tasks_select_members" on public.tasks;
create policy "tasks_select_members" on public.tasks for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists "tasks_insert_members" on public.tasks;
create policy "tasks_insert_members" on public.tasks for insert to authenticated with check (public.is_couple_member(couple_id) and created_by = auth.uid());
drop policy if exists "tasks_update_members" on public.tasks;
create policy "tasks_update_members" on public.tasks for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
drop policy if exists "tasks_delete_members" on public.tasks;
create policy "tasks_delete_members" on public.tasks for delete to authenticated using (public.is_couple_member(couple_id));

drop policy if exists "responses_select_members" on public.responses;
create policy "responses_select_members" on public.responses for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists "responses_insert_self" on public.responses;
create policy "responses_insert_self" on public.responses for insert to authenticated with check (public.is_couple_member(couple_id) and from_user = auth.uid());
drop policy if exists "responses_delete_self" on public.responses;
create policy "responses_delete_self" on public.responses for delete to authenticated using (from_user = auth.uid());

drop policy if exists "wishes_select_members" on public.wishes;
create policy "wishes_select_members" on public.wishes for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists "wishes_insert_members" on public.wishes;
create policy "wishes_insert_members" on public.wishes for insert to authenticated with check (public.is_couple_member(couple_id) and created_by = auth.uid());
drop policy if exists "wishes_update_members" on public.wishes;
create policy "wishes_update_members" on public.wishes for update to authenticated using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
drop policy if exists "wishes_delete_members" on public.wishes;
create policy "wishes_delete_members" on public.wishes for delete to authenticated using (public.is_couple_member(couple_id));

drop policy if exists "memories_select_members" on public.memories;
create policy "memories_select_members" on public.memories for select to authenticated using (public.is_couple_member(couple_id));
drop policy if exists "memories_insert_manual" on public.memories;
create policy "memories_insert_manual" on public.memories for insert to authenticated with check (public.is_couple_member(couple_id) and source_type = 'manual' and created_by = auth.uid());
drop policy if exists "memories_update_manual" on public.memories;
create policy "memories_update_manual" on public.memories for update to authenticated using (public.is_couple_member(couple_id) and source_type = 'manual') with check (public.is_couple_member(couple_id) and source_type = 'manual');
drop policy if exists "memories_delete_manual" on public.memories;
create policy "memories_delete_manual" on public.memories for delete to authenticated using (public.is_couple_member(couple_id) and source_type = 'manual');

grant execute on function public.create_couple(text, text) to authenticated;
grant execute on function public.join_couple_by_code(text, text) to authenticated;
grant execute on function public.is_couple_member(uuid) to authenticated;
grant execute on function public.shares_couple_with(uuid) to authenticated;
grant execute on function public.current_couple_role(uuid) to authenticated;

-- 开启实时同步。若某张表已加入 publication，重复执行时忽略错误。
do $$
declare
  table_name text;
begin
  foreach table_name in array array['daily_notes','daily_entries','tasks','responses','wishes','memories']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
