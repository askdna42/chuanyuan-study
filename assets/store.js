/* 船员学习室 · 数据层
   两种模式共用同一套接口：
   - local：数据存在当前设备的浏览器里，零配置，适合试手感
   - cloud：Supabase 云端，手机电脑平板同一个账号实时同步 */

(function () {
  const CFG = window.CY_CONFIG || {};
  const SEED = window.CY_SEED;
  const DB_KEY = 'cy_db_v1';
  const SESSION_KEY = 'cy_session';
  const CLOUD_DOMAIN = 'cy.local';

  /* ---------------- 工具 ---------------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const shiftDay = (dateStr, n) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  };
  async function sha256(text) {
    if (!window.crypto || !window.crypto.subtle) return 'plain:' + text;
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const USERNAME_RE = /^[A-Za-z0-9._-]{3,20}$/;

  /* ---------------- 本机模式 ---------------- */
  const Local = {
    db: null,

    load() {
      try { this.db = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { this.db = null; }
      if (!this.db) this.db = this.blank();
      /* 顺手修一下历史数据：早期版本有一条"新建内容 id 为空"的 bug，
         那种条目在列表里点不开也删不掉。这里给它补上 id。 */
      let fixed = 0;
      ['items', 'tasks', 'rewards', 'exams', 'invites', 'checkins'].forEach(k => {
        (this.db[k] || []).forEach(x => { if (x && !x.id) { x.id = uid(); fixed++; } });
      });
      if (fixed) this.flush();
      return this.db;
    },
    blank() {
      return { version: 1, users: [], tasks: [], checkins: [], items: [], rewards: [], exams: [], invites: [], seeded: [] };
    },
    flush() { localStorage.setItem(DB_KEY, JSON.stringify(this.db)); },
    user(id) { return this.db.users.find(u => u.id === id) || null; },
    me() { return this.user(localStorage.getItem(SESSION_KEY)); },

    /* 首次登录时给这个账号铺一份初始内容 */
    ensureSeed(userId) {
      if (this.db.seeded.includes(userId)) return;
      const now = new Date().toISOString();
      SEED.EXAMS.forEach(e => this.db.exams.push({ id: uid(), userId, name: e.name, date: e.date, note: e.note }));
      SEED.REWARDS.forEach(r => this.db.rewards.push({ id: uid(), userId, title: r.title, cost: r.cost, redeemed: false, createdAt: now }));
      Object.keys(SEED.MINDMAPS).forEach(mid => {
        const mm = SEED.MINDMAPS[mid];
        this.db.items.push({
          id: uid(), userId, authorName: '系统预置', module: mid, kind: 'mindmap',
          title: mm.title, content: JSON.stringify(mm.root), visibility: 'private',
          likes: [], createdAt: now, updatedAt: now
        });
      });
      this.db.seeded.push(userId);
      this.flush();
    },

    async signUp({ username, nickname, password, invite }) {
      if (!username || !password) throw new Error('账号和密码都要填');
      if (password.length < 6) throw new Error('密码至少 6 位');
      const users = this.db.users;
      if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('这个登录名已经有人用了');

      const isFirst = users.length === 0;
      if (!isFirst) {
        const code = (invite || '').trim().toUpperCase();
        if (!code) throw new Error('请填写邀请码（第一个注册的人不需要）');
        const inv = this.db.invites.find(i => i.code === code && !i.usedBy);
        if (!inv) throw new Error('邀请码无效或已被使用');
        inv.usedBy = username; inv.usedAt = new Date().toISOString();
      }
      const u = {
        id: uid(), username, nickname: (nickname || username).trim(),
        pass: await sha256(password), role: isFirst ? 'admin' : 'member',
        points: 0, streak: 0, lastCheckin: '', createdAt: new Date().toISOString()
      };
      users.push(u);
      localStorage.setItem(SESSION_KEY, u.id);
      this.flush();
      this.ensureSeed(u.id);
      return u;
    },

    async signIn({ username, password }) {
      const u = this.db.users.find(x => x.username.toLowerCase() === (username || '').trim().toLowerCase());
      if (!u) throw new Error('没有这个账号');
      if (u.pass !== await sha256(password)) throw new Error('密码不对');
      localStorage.setItem(SESSION_KEY, u.id);
      this.ensureSeed(u.id);
      return u;
    },

    signOut() { localStorage.removeItem(SESSION_KEY); },

    updateUser(id, patch) {
      const u = this.user(id); if (!u) return;
      Object.assign(u, patch); this.flush();
    },

    listUsers() { return this.db.users.map(({ pass, ...rest }) => rest); },

    addTask(t) { this.db.tasks.push({ id: uid(), done: false, createdAt: new Date().toISOString(), ...t }); this.flush(); },
    toggleTask(id, done) { const t = this.db.tasks.find(x => x.id === id); if (t) { t.done = done; this.flush(); } },
    delTask(id) { this.db.tasks = this.db.tasks.filter(x => x.id !== id); this.flush(); },
    listTasks(userId, date) { return this.db.tasks.filter(t => t.userId === userId && t.date === date); },
    /* 取一段日期内的任务（日历用，避免一天一次请求） */
    listTasksRange(userId, from, to) {
      return this.db.tasks
        .filter(t => t.userId === userId && t.date >= from && t.date <= to)
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    },

    listCheckins(userId) { return this.db.checkins.filter(c => c.userId === userId); },

    /* 打卡：算连续天数、加分、返回本次获得多少分 */
    doCheckin(userId) {
      const d = today();
      const u = this.user(userId);
      if (u.lastCheckin === d) return { ok: false, msg: '今天已经打过卡啦' };

      const y = shiftDay(d, -1);
      const streak = u.lastCheckin === y ? (u.streak || 0) + 1 : 1;
      const tasks = this.listTasks(userId, d);
      const allDone = tasks.length > 0 && tasks.every(t => t.done);

      let gain = SEED.POINTS_RULE.checkin;
      const notes = ['打卡 +' + SEED.POINTS_RULE.checkin];
      if (allDone) { gain += SEED.POINTS_RULE.allTasks; notes.push('任务全清 +' + SEED.POINTS_RULE.allTasks); }
      if (streak > 0 && streak % 7 === 0) { gain += SEED.POINTS_RULE.week7; notes.push('连签 7 天 +' + SEED.POINTS_RULE.week7); }

      this.db.checkins.push({ id: uid(), userId, date: d, points: gain, createdAt: new Date().toISOString() });
      u.lastCheckin = d; u.streak = streak; u.points = (u.points || 0) + gain;
      this.flush();
      return { ok: true, gain, streak, msg: notes.join('，') };
    },

    addPoints(userId, n) {
      const u = this.user(userId); if (!u) return;
      u.points = (u.points || 0) + n; this.flush();
    },

    listItems(filter = {}) {
      let arr = this.db.items.slice();
      if (filter.userId) arr = arr.filter(i => i.userId === filter.userId);
      if (filter.module) arr = arr.filter(i => i.module === filter.module);
      if (filter.kind) arr = arr.filter(i => i.kind === filter.kind);
      if (filter.visibility) arr = arr.filter(i => i.visibility === filter.visibility);
      if (filter.author) arr = arr.filter(i => i.authorName === filter.author);
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },
    saveItem(item) {
      if (item.id) {
        const i = this.db.items.find(x => x.id === item.id);
        if (i) { Object.assign(i, item, { updatedAt: new Date().toISOString() }); this.flush(); return i; }
      }
      const now = new Date().toISOString();
      const fresh = Object.assign({ likes: [], createdAt: now, updatedAt: now, visibility: 'private', kind: 'note' }, item);
      /* ⚠️ 这里必须再兜一次底：调用方常写成 { id: editing.id }，
         新建时 editing.id 是 undefined，Object.assign 会用 undefined 把上面生成的 id 覆盖掉，
         结果这条内容 id 变成 undefined —— 列表里点它没反应、也删不掉。 */
      if (!fresh.id) fresh.id = uid();
      this.db.items.push(fresh); this.flush();
      return fresh;
    },
    delItem(id) { this.db.items = this.db.items.filter(x => x.id !== id); this.flush(); },
    toggleLike(id, userId) {
      const i = this.db.items.find(x => x.id === id); if (!i) return 0;
      i.likes = i.likes || [];
      const k = i.likes.indexOf(userId);
      if (k >= 0) i.likes.splice(k, 1); else i.likes.push(userId);
      this.flush();
      return i.likes.length;
    },

    listRewards(userId) { return this.db.rewards.filter(r => r.userId === userId); },
    addReward(userId, title, cost) { this.db.rewards.push({ id: uid(), userId, title, cost, redeemed: false, createdAt: new Date().toISOString() }); this.flush(); },
    delReward(id) { this.db.rewards = this.db.rewards.filter(r => r.id !== id); this.flush(); },
    redeemReward(id, userId) {
      const r = this.db.rewards.find(x => x.id === id); const u = this.user(userId);
      if (!r || !u) return { ok: false, msg: '找不到这个奖励' };
      if (r.redeemed) return { ok: false, msg: '已经兑换过啦' };
      if ((u.points || 0) < r.cost) return { ok: false, msg: '积分不够，还差 ' + (r.cost - u.points) + ' 分' };
      u.points -= r.cost; r.redeemed = true; r.redeemedAt = new Date().toISOString();
      this.flush();
      return { ok: true, msg: '已兑换「' + r.title + '」，去享受吧' };
    },

    listExams(userId) { return this.db.exams.filter(e => e.userId === userId); },
    saveExam(userId, exam) {
      if (exam.id) {
        const e = this.db.exams.find(x => x.id === exam.id);
        if (e) { Object.assign(e, exam); this.flush(); return e; }
      }
      const fresh = Object.assign({ id: uid(), userId }, exam);
      this.db.exams.push(fresh); this.flush(); return fresh;
    },
    delExam(id) { this.db.exams = this.db.exams.filter(e => e.id !== id); this.flush(); },

    listInvites() { return this.db.invites.slice().reverse(); },
    createInvite(userId) {
      const code = 'CY' + Math.random().toString(36).slice(2, 8).toUpperCase();
      this.db.invites.push({ code, createdBy: userId, usedBy: '', usedAt: '', createdAt: new Date().toISOString() });
      this.flush();
      return code;
    },

    dump() { return JSON.stringify(this.db, null, 2); },
    restore(raw) { this.db = Object.assign(this.blank(), JSON.parse(raw)); this.flush(); }
  };

  /* ---------------- 云端模式（Supabase） ---------------- */
  const Cloud = {
    sb: null,

    async connect() {
      const mod = await import('https://esm.sh/@supabase/supabase-js@2');
      this.sb = mod.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    },
    email(username) { return String(username).trim().toLowerCase() + '@' + CLOUD_DOMAIN; },

    async me() {
      const { data: { user } } = await this.sb.auth.getUser();
      if (!user) return null;
      const { data, error } = await this.sb.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return {
        id: data.id, username: data.username, nickname: data.nickname,
        role: data.role, points: data.points || 0, streak: data.streak || 0,
        lastCheckin: data.last_checkin || '', createdAt: data.created_at
      };
    },

    async signUp({ username, nickname, password, invite }) {
      if (!USERNAME_RE.test(username || '')) throw new Error('云端模式下登录名只能用 3—20 位字母、数字、点、下划线或短横线（昵称可以随便填中文）');
      if (password.length < 6) throw new Error('密码至少 6 位');
      const { error } = await this.sb.auth.signUp({
        email: this.email(username), password,
        options: { data: { username, nickname: (nickname || username).trim(), invite: (invite || '').trim().toUpperCase() } }
      });
      if (error) throw new Error(error.message);
      return await this.me();
    },

    async signIn({ username, password }) {
      const input = String(username || '').trim();
      const mail = input.includes('@') ? input : this.email(input);
      const { error } = await this.sb.auth.signInWithPassword({ email: mail, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? '账号或密码不对' : error.message);
      return await this.me();
    },

    async signOut() { await this.sb.auth.signOut(); },

    async updateUser(id, patch) {
      const row = {};
      if (patch.points !== undefined) row.points = patch.points;
      if (patch.streak !== undefined) row.streak = patch.streak;
      if (patch.lastCheckin !== undefined) row.last_checkin = patch.lastCheckin;
      if (patch.nickname !== undefined) row.nickname = patch.nickname;
      await this.sb.from('profiles').update(row).eq('id', id);
    },

    async listUsers() {
      const { data } = await this.sb.from('profiles').select('id,username,nickname,role,points,streak');
      return data || [];
    },

    async addTask(t) {
      await this.sb.from('tasks').insert({ user_id: t.userId, date: t.date, module: t.module, title: t.title });
    },
    async toggleTask(id, done) { await this.sb.from('tasks').update({ done }).eq('id', id); },
    async delTask(id) { await this.sb.from('tasks').delete().eq('id', id); },
    async listTasks(userId, date) {
      const { data } = await this.sb.from('tasks').select('*').eq('user_id', userId).eq('date', date).order('created_at');
      return (data || []).map(t => ({ id: t.id, userId: t.user_id, date: t.date, module: t.module, title: t.title, done: t.done }));
    },
    async listTasksRange(userId, from, to) {
      const { data } = await this.sb.from('tasks').select('*').eq('user_id', userId)
        .gte('date', from).lte('date', to).order('date');
      return (data || []).map(t => ({ id: t.id, userId: t.user_id, date: t.date, module: t.module, title: t.title, done: t.done }));
    },
    async listCheckins(userId) {
      const { data } = await this.sb.from('checkins').select('*').eq('user_id', userId);
      return (data || []).map(c => ({ id: c.id, userId: c.user_id, date: c.date, points: c.points }));
    },

    async doCheckin(userId) {
      const d = today();
      const u = await this.me();
      if (u.lastCheckin === d) return { ok: false, msg: '今天已经打过卡啦' };

      let streak = 1;
      const { data: last } = await this.sb.from('checkins').select('date').eq('user_id', userId)
        .order('date', { ascending: false }).limit(1);
      if (last && last[0] && last[0].date === shiftDay(d, -1)) streak = (u.streak || 0) + 1;

      const tasks = await this.listTasks(userId, d);
      const allDone = tasks.length > 0 && tasks.every(t => t.done);

      let gain = SEED.POINTS_RULE.checkin;
      const notes = ['打卡 +' + SEED.POINTS_RULE.checkin];
      if (allDone) { gain += SEED.POINTS_RULE.allTasks; notes.push('任务全清 +' + SEED.POINTS_RULE.allTasks); }
      if (streak % 7 === 0) { gain += SEED.POINTS_RULE.week7; notes.push('连签 7 天 +' + SEED.POINTS_RULE.week7); }

      const { error } = await this.sb.from('checkins').insert({ user_id: userId, date: d, points: gain });
      if (error) return { ok: false, msg: error.message };
      await this.updateUser(userId, { points: (u.points || 0) + gain, streak, lastCheckin: d });
      return { ok: true, gain, streak, msg: notes.join('，') };
    },

    async seedFor(userId, nickname) {
      const { count } = await this.sb.from('items').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (count > 0) return;
      const exams = SEED.EXAMS.map(e => ({ user_id: userId, name: e.name, exam_date: e.date || null, note: e.note }));
      await this.sb.from('exams').insert(exams.filter(e => e.exam_date || e.note));
      await this.sb.from('rewards').insert(SEED.REWARDS.map(r => ({ user_id: userId, title: r.title, cost: r.cost })));
      await this.sb.from('items').insert(Object.keys(SEED.MINDMAPS).map(mid => ({
        user_id: userId, author_name: '系统预置', module: mid, kind: 'mindmap',
        title: SEED.MINDMAPS[mid].title, content: JSON.stringify(SEED.MINDMAPS[mid].root),
        visibility: 'private'
      })));
    },

    async listItems(filter = {}) {
      let q = this.sb.from('items').select('*');
      if (filter.userId) q = q.eq('user_id', filter.userId);
      if (filter.module) q = q.eq('module', filter.module);
      if (filter.kind) q = q.eq('kind', filter.kind);
      if (filter.visibility) q = q.eq('visibility', filter.visibility);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(i => ({
        id: i.id, userId: i.user_id, authorName: i.author_name, module: i.module, kind: i.kind,
        title: i.title, content: i.content, visibility: i.visibility,
        likes: i.likes || [], createdAt: i.created_at, updatedAt: i.updated_at
      }));
    },
    async saveItem(item) {
      const row = {
        user_id: item.userId, author_name: item.authorName, module: item.module, kind: item.kind,
        title: item.title, content: item.content, visibility: item.visibility || 'private'
      };
      if (item.id) {
        row.updated_at = new Date().toISOString();
        const { data, error } = await this.sb.from('items').update(row).eq('id', item.id).select().single();
        if (error) throw error;
        return data.id;
      }
      const { data, error } = await this.sb.from('items').insert(row).select().single();
      if (error) throw error;
      return data.id;
    },
    async delItem(id) { await this.sb.from('items').delete().eq('id', id); },
    async toggleLike(id, userId) {
      const { data } = await this.sb.from('items').select('likes').eq('id', id).single();
      const likes = (data && data.likes) || [];
      const k = likes.indexOf(userId);
      if (k >= 0) likes.splice(k, 1); else likes.push(userId);
      await this.sb.from('items').update({ likes }).eq('id', id);
      return likes.length;
    },

    async listRewards(userId) {
      const { data } = await this.sb.from('rewards').select('*').eq('user_id', userId).order('created_at');
      return (data || []).map(r => ({ id: r.id, userId: r.user_id, title: r.title, cost: r.cost, redeemed: r.redeemed }));
    },
    async addReward(userId, title, cost) { await this.sb.from('rewards').insert({ user_id: userId, title, cost }); },
    async delReward(id) { await this.sb.from('rewards').delete().eq('id', id); },
    async redeemReward(id, userId) {
      const u = await this.me();
      const { data: r } = await this.sb.from('rewards').select('*').eq('id', id).single();
      if (!r) return { ok: false, msg: '找不到这个奖励' };
      if (r.redeemed) return { ok: false, msg: '已经兑换过啦' };
      if ((u.points || 0) < r.cost) return { ok: false, msg: '积分不够，还差 ' + (r.cost - u.points) + ' 分' };
      await this.sb.from('rewards').update({ redeemed: true }).eq('id', id);
      await this.updateUser(userId, { points: u.points - r.cost });
      return { ok: true, msg: '已兑换「' + r.title + '」，去享受吧' };
    },

    async listExams(userId) {
      const { data } = await this.sb.from('exams').select('*').eq('user_id', userId).order('exam_date');
      return (data || []).map(e => ({ id: e.id, userId: e.user_id, name: e.name, date: e.exam_date || '', note: e.note || '' }));
    },
    async saveExam(userId, exam) {
      const row = { user_id: userId, name: exam.name, exam_date: exam.date || null, note: exam.note || '' };
      if (exam.id) { await this.sb.from('exams').update(row).eq('id', exam.id); return exam.id; }
      const { data } = await this.sb.from('exams').insert(row).select().single();
      return data.id;
    },
    async delExam(id) { await this.sb.from('exams').delete().eq('id', id); },

    async listInvites() {
      const { data } = await this.sb.from('invites').select('*').order('created_at', { ascending: false });
      return (data || []).map(i => ({ code: i.code, createdBy: i.created_by, usedBy: i.used_by || '', createdAt: i.created_at }));
    },
    async createInvite(userId) {
      const code = 'CY' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const { error } = await this.sb.from('invites').insert({ code, created_by: userId });
      if (error) throw new Error(error.message);
      return code;
    }
  };

  /* ---------------- 对外统一接口 ---------------- */
  const Store = {
    mode: (CFG.syncMode === 'cloud' && CFG.supabaseUrl && CFG.supabaseAnonKey) ? 'cloud' : 'local',
    _user: null,

    async init() {
      if (this.mode === 'cloud') {
        try { await Cloud.connect(); this._user = await Cloud.me(); }
        catch (e) { console.warn('云端连接失败，退回本机模式', e); this.mode = 'local'; }
      }
      if (this.mode === 'local') { Local.load(); this._user = Local.me(); }
      return this._user;
    },

    user() { return this._user; },
    setUser(u) { this._user = u; },

    async refresh() {
      if (this.mode === 'cloud') this._user = await Cloud.me();
      else this._user = Local.me();
      return this._user;
    },

    async signUp(p) {
      const u = this.mode === 'cloud' ? await Cloud.signUp(p) : await Local.signUp(p);
      if (this.mode === 'cloud' && u) await Cloud.seedFor(u.id, u.nickname);
      this._user = u;
      return u;
    },
    async signIn(p) {
      const u = this.mode === 'cloud' ? await Cloud.signIn(p) : await Local.signIn(p);
      this._user = u;
      return u;
    },
    async signOut() {
      if (this.mode === 'cloud') await Cloud.signOut(); else Local.signOut();
      this._user = null;
    },

    listUsers() { return this.mode === 'cloud' ? Cloud.listUsers() : Local.listUsers(); },
    updateUser(id, patch) { return this.mode === 'cloud' ? Cloud.updateUser(id, patch) : Local.updateUser(id, patch); },
    addPoints(n) { return this.mode === 'cloud' ? Cloud.updateUser(this._user.id, { points: (this._user.points || 0) + n }) : Local.addPoints(this._user.id, n); },

    listTasks(date) { return this.mode === 'cloud' ? Cloud.listTasks(this._user.id, date) : Local.listTasks(this._user.id, date); },
    listTasksRange(from, to) { return this.mode === 'cloud' ? Cloud.listTasksRange(this._user.id, from, to) : Local.listTasksRange(this._user.id, from, to); },
    addTask(t) { return this.mode === 'cloud' ? Cloud.addTask({ userId: this._user.id, ...t }) : Local.addTask({ userId: this._user.id, ...t }); },
    toggleTask(id, done) { return this.mode === 'cloud' ? Cloud.toggleTask(id, done) : Local.toggleTask(id, done); },
    delTask(id) { return this.mode === 'cloud' ? Cloud.delTask(id) : Local.delTask(id); },

    listCheckins() { return this.mode === 'cloud' ? Cloud.listCheckins(this._user.id) : Local.listCheckins(this._user.id); },
    async doCheckin() {
      const r = this.mode === 'cloud' ? await Cloud.doCheckin(this._user.id) : Local.doCheckin(this._user.id);
      await this.refresh();
      return r;
    },

    listItems(f) { return this.mode === 'cloud' ? Cloud.listItems(f) : Local.listItems(f); },
    saveItem(i) { return this.mode === 'cloud' ? Cloud.saveItem(i) : Local.saveItem(i); },
    delItem(id) { return this.mode === 'cloud' ? Cloud.delItem(id) : Local.delItem(id); },
    toggleLike(id) { return this.mode === 'cloud' ? Cloud.toggleLike(id, this._user.id) : Local.toggleLike(id, this._user.id); },

    listRewards() { return this.mode === 'cloud' ? Cloud.listRewards(this._user.id) : Local.listRewards(this._user.id); },
    addReward(t, c) { return this.mode === 'cloud' ? Cloud.addReward(this._user.id, t, c) : Local.addReward(this._user.id, t, c); },
    delReward(id) { return this.mode === 'cloud' ? Cloud.delReward(id) : Local.delReward(id); },
    async redeemReward(id) {
      const r = this.mode === 'cloud' ? await Cloud.redeemReward(id, this._user.id) : Local.redeemReward(id, this._user.id);
      await this.refresh();
      return r;
    },

    listExams() { return this.mode === 'cloud' ? Cloud.listExams(this._user.id) : Local.listExams(this._user.id); },
    saveExam(e) { return this.mode === 'cloud' ? Cloud.saveExam(this._user.id, e) : Local.saveExam(this._user.id, e); },
    delExam(id) { return this.mode === 'cloud' ? Cloud.delExam(id) : Local.delExam(id); },

    listInvites() { return this.mode === 'cloud' ? Cloud.listInvites() : Local.listInvites(); },
    createInvite() { return this.mode === 'cloud' ? Cloud.createInvite(this._user.id) : Local.createInvite(this._user.id); },

    exportAll() {
      if (this.mode === 'cloud') return JSON.stringify({ note: '云端模式的数据在 Supabase，请用 Supabase 控制台导出备份' }, null, 2);
      return Local.dump();
    },
    importAll(raw) { Local.restore(raw); this._user = Local.me(); }
  };

  window.CY = { Store, Local, Cloud, util: { uid, today, shiftDay, sha256, USERNAME_RE } };
})();
