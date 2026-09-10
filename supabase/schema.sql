-- ============================================================
-- 船员学习室 · 数据库结构（Supabase）
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 一次跑完，不用改任何东西。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1. 账号资料 ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  nickname     text not null default '',
  role         text not null default 'member',   -- admin / member
  points       int  not null default 0,
  streak       int  not null default 0,
  last_checkin date,
  created_at   timestamptz not null default now()
);

-- ---------- 2. 邀请码 ----------
create table if not exists public.invites (
  code       text primary key,
  created_by uuid references public.profiles(id) on delete set null,
  used_by    text,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 3. 每日学习任务 ----------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  module     text,
  title      text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_date on public.tasks(user_id, date);

-- ---------- 4. 打卡记录 ----------
create table if not exists public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  points     int  not null default 5,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------- 5. 笔记 / 思维导图 ----------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  author_name text,
  module      text,
  kind        text not null default 'note',       -- note / mindmap
  title       text not null default '',
  content     text default '',
  visibility  text not null default 'private',    -- private / public
  likes       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_public on public.items(visibility, created_at desc);
create index if not exists items_user on public.items(user_id, created_at desc);

-- ---------- 6. 自定义奖励 ----------
create table if not exists public.rewards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  cost       int  not null default 100,
  redeemed   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 7. 考试倒计时 ----------
create table if not exists public.exams (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  exam_date  date,
  note       text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 8. 注册时自动建档：第一个人是管理员，之后必须凭邀请码
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_exists boolean;
  v_invite       text;
  v_username     text;
begin
  v_username := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
  select exists(select 1 from public.profiles where role = 'admin') into v_admin_exists;

  if v_admin_exists then
    v_invite := upper(coalesce(new.raw_user_meta_data->>'invite', ''));
    if v_invite = '' then
      raise exception '注册需要邀请码';
    end if;
    update public.invites
       set used_by = v_username, used_at = now()
     where code = v_invite and used_by is null;
    if not found then
      raise exception '邀请码无效或已被使用';
    end if;
    insert into public.profiles(id, username, nickname, role)
    values (new.id, v_username,
            coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), v_username), 'member');
  else
    insert into public.profiles(id, username, nickname, role)
    values (new.id, v_username,
            coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), v_username), 'admin');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 9. 行级权限（RLS）：各自的数据只能自己看，公开内容大家能看
-- ============================================================
alter table public.profiles enable row level security;
alter table public.invites  enable row level security;
alter table public.tasks    enable row level security;
alter table public.checkins enable row level security;
alter table public.items    enable row level security;
alter table public.rewards  enable row level security;
alter table public.exams    enable row level security;

-- profiles：昵称要显示在瀑布流上，所以所有人可读；只能改自己
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);
create policy profiles_update on public.profiles for update using (auth.uid() = id);

-- invites：只有管理员能看和发（注册校验走的是数据库触发器，不受这里限制）
drop policy if exists invites_read   on public.invites;
drop policy if exists invites_insert on public.invites;
drop policy if exists invites_update on public.invites;
create policy invites_read   on public.invites for select
  using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy invites_insert on public.invites for insert
  with check (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy invites_update on public.invites for update
  using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 私人数据：只有自己
do $$
declare t text;
begin
  foreach t in array array['tasks', 'checkins', 'rewards', 'exams'] loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format('create policy %I_own on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
  end loop;
end $$;

-- items：自己全权，公开的大家可读
drop policy if exists items_read   on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_read   on public.items for select using (auth.uid() = user_id or visibility = 'public');
create policy items_insert on public.items for insert with check (auth.uid() = user_id);
create policy items_update on public.items for update using (auth.uid() = user_id);
create policy items_delete on public.items for delete using (auth.uid() = user_id);

-- ---------- 10. 权限授予 ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ============================================================
-- 完成。接下来去 Authentication → Providers 确认 Email 已开启，
-- 建议把「Confirm email」关掉（否则注册后要收邮件才能登录）。
-- ============================================================
