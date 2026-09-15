/* 船员学习室 · 界面与交互 */
(function () {
  const Store = window.CY.Store, SEED = window.CY_SEED, U = window.CY.util, MIND = window.CY_MIND;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = U.today;

  const MODULES = SEED.MODULES;
  const modName = id => (MODULES.find(m => m.id === id) || { name: id || '未分类' }).name;
  const modShort = id => (MODULES.find(m => m.id === id) || { short: '其他' }).short;

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / 86400000);
  }
  function fillModuleSelect(sel, withAll) {
    sel.innerHTML = (withAll ? '<option value="">全部模块</option>' : '') +
      MODULES.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  }

  /* ================= 导图（工具区仍用大纲树渲染预置内容） ================= */
  function renderTree(node, level, collapsible) {
    level = level || 0;
    const kids = node.c || [];
    const tgl = kids.length && collapsible ? '<button class="mm-toggle" data-toggle>−</button>' : (kids.length ? '<span class="mm-toggle" style="visibility:hidden">−</span>' : '');
    return `<ul class="${level === 0 ? 'mm-root' : 'mm-children'}">` +
      `<li class="mm-node mm-l${Math.min(level, 3)}"><span class="mm-label">${tgl}${esc(node.t)}</span>` +
      (kids.length ? kids.map(k => renderTree(k, level + 1, collapsible)).join('') : '') +
      `</li></ul>`;
  }

  /* 一条内容在卡片上显示的摘要（导图走图形引擎） */
  function itemExcerpt(i, n) {
    const c = String(i.content || '');
    if (i.kind === 'mindmap') {
      try { return MIND.excerpt(MIND.parse(c), n); } catch (e) { return ''; }
    }
    return c.slice(0, n);
  }

  /* ================= 默写 ================= */
  /* 把文本切成 [文字段] 与 [挖空段] */
  function buildRecite(text, mode, tailN) {
    const lines = String(text || '').split('\n');
    const out = [];
    lines.forEach(raw => {
      if (!raw.trim()) { out.push([{ type: 't', v: '\n' }]); return; }
      const segs = [];
      const markRe = /【【(.+?)】】/g;
      if (markRe.test(raw)) {
        let last = 0, m; markRe.lastIndex = 0;
        while ((m = markRe.exec(raw))) {
          if (m.index > last) segs.push({ type: 't', v: raw.slice(last, m.index) });
          segs.push({ type: 'b', v: m[1] });
          last = m.index + m[0].length;
        }
        if (last < raw.length) segs.push({ type: 't', v: raw.slice(last) });
      } else if (mode === 'auto') {
        const sep = raw.match(/^([^*=＝:：]{2,}?)\s*[=＝:：→]\s*(.+)$/);
        const brk = raw.match(/^(.*?)[（(]([^）)]{2,})[）)](.*)$/);
        if (sep) { segs.push({ type: 't', v: sep[1] + '　＝　' }, { type: 'b', v: sep[2].trim() }); }
        else if (brk) { segs.push({ type: 't', v: brk[1] + '（' }, { type: 'b', v: brk[2] }, { type: 't', v: '）' + brk[3] }); }
        else { segs.push({ type: 't', v: raw + '　' }, { type: 'b', v: '……' }); }
      } else if (mode === 'tail') {
        const n = Math.max(2, Number(tailN) || 4);
        const txt = raw.trim();
        if (txt.length <= n) segs.push({ type: 'b', v: txt });
        else segs.push({ type: 't', v: txt.slice(0, txt.length - n) + '　' }, { type: 'b', v: txt.slice(txt.length - n) });
      } else {
        segs.push({ type: 't', v: raw });
      }
      segs.push({ type: 't', v: '\n' });
      out.push(segs);
    });
    return out;
  }
  const clean = s => String(s || '').replace(/[\s，。、；：？！“”‘’（）()【】《》,.;:?!"'`~—_\-＝=+×÷/\\|]/g, '');
  function diffHtml(user, answer) {
    const a = clean(answer), b = clean(user);
    if (a === b) return '';
    let html = '<div class="hint" style="margin-top:2px">正确答案：';
    for (let i = 0; i < a.length; i++) {
      html += (b[i] === a[i]) ? esc(a[i]) : `<span class="diff-del">${esc(a[i])}</span>`;
    }
    if (b.length > a.length) html += `<span class="diff-add">多打了 ${esc(b.slice(a.length))}</span>`;
    html += '</div>';
    return html;
  }

  /* ================= 登录 ================= */
  let authTab = 'login';
  function showAuth() {
    $('#boot').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#bottomNav').classList.add('hidden');
    const cloudReady = Store.mode === 'cloud';
    $('#modeHint').innerHTML = cloudReady
      ? '当前为 <b>云端模式</b>：手机、电脑、平板用同一个账号登录，数据自动同步。'
      : '当前为 <b>本机模式</b>：数据只存在这台设备的浏览器里。想让多端同步，请填写 <code>assets/config.js</code> 里的 Supabase 配置（见《部署与配置指南.md》）。';
    $('#inviteField').classList.toggle('hidden', authTab !== 'register');
  }
  function bindAuth() {
    $$('#authScreen .tab').forEach(b => b.onclick = () => {
      authTab = b.dataset.authtab;
      $$('#authScreen .tab').forEach(x => x.classList.toggle('active', x === b));
      $('#formLogin').classList.toggle('hidden', authTab !== 'login');
      $('#formRegister').classList.toggle('hidden', authTab !== 'register');
      $('#authMsg').textContent = '';
      $('#inviteField').classList.toggle('hidden', authTab !== 'register');
    });
    $('#formLogin').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#authMsg'); msg.className = 'msg'; msg.textContent = '登录中……';
      try {
        await Store.signIn({ username: $('#loginUser').value, password: $('#loginPass').value });
        await enterApp();
      } catch (err) { msg.textContent = err.message || String(err); }
    };
    $('#formRegister').onsubmit = async e => {
      e.preventDefault();
      const msg = $('#authMsg'); msg.className = 'msg'; msg.textContent = '创建中……';
      try {
        await Store.signUp({
          username: $('#regUser').value.trim(),
          nickname: $('#regNick').value.trim() || $('#regUser').value.trim(),
          password: $('#regPass').value,
          invite: $('#regInvite').value
        });
        await enterApp();
        toast('账号创建好了，第一个注册的人自动是管理员');
      } catch (err) { msg.textContent = err.message || String(err); }
    };
  }

  /* ================= 外壳 ================= */
  let view = 'home';
  const PAGES = {
    home: ['仪表盘', '看见今天要做的事，然后一件件做掉'],
    notes: ['我的笔记', '六大模块的笔记与思维导图，按分类或日期看'],
    cards: ['卡片记忆', '先回忆，再翻面。忘了的会自动挑回来重来'],
    forum: ['瀑布流', '大家发布的笔记，互相偷师'],
    tools: ['行测助手', '大九九乘法表、速算练习、公式与图推速查'],
    settings: ['设置', '账号、邀请码、数据备份']
  };
  const isNarrow = () => window.innerWidth <= 900;

  /* 侧栏：桌面折叠 / 手机抽屉，状态记在本地 */
  function applySidebar() {
    document.body.classList.toggle('sb-collapsed', localStorage.getItem('cy_sb') === '1' && !isNarrow());
    if (!isNarrow()) document.body.classList.remove('sb-open');
  }
  function toggleSidebar() {
    if (isNarrow()) {
      document.body.classList.toggle('sb-open');
    } else {
      const next = !document.body.classList.contains('sb-collapsed');
      localStorage.setItem('cy_sb', next ? '1' : '0');
      applySidebar();
    }
  }
  function closeDrawer() { document.body.classList.remove('sb-open'); }

  async function enterApp() {
    $('#boot').classList.add('hidden');
    $('#authScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#bottomNav').classList.remove('hidden');
    applySidebar();
    await refreshUserChip();
    switchView('home');
  }
  async function refreshUserChip() {
    const u = await Store.refresh();
    if (!u) return showAuth();
    $('#sideName').textContent = u.nickname || u.username;
    $('#sideAvatar').textContent = (u.nickname || u.username || '船').slice(0, 1);
    $('#sideRole').textContent = u.role === 'admin' ? '管理员' : '学员';
    $('#topPoints').textContent = '积分 ' + (u.points || 0);
    $('#topStreak').textContent = '连签 ' + (u.streak || 0) + ' 天';
  }
  function switchView(v) {
    view = v;
    ['home', 'notes', 'cards', 'forum', 'tools', 'settings'].forEach(k => $('#view' + k[0].toUpperCase() + k.slice(1)).classList.toggle('hidden', k !== v));
    $$('#navSide .nav-item, #bottomNav button').forEach(b => b.classList.toggle('active', b.dataset.nav === v));
    $('#pageTitle').textContent = PAGES[v][0];
    $('#pageDesc').textContent = PAGES[v][1];
    closeDrawer();
    if (v === 'home') renderHome();
    if (v === 'notes') renderNotes();
    if (v === 'cards') window.CY_CARDS.render();
    if (v === 'forum') renderForum();
    if (v === 'tools') renderTools();
    if (v === 'settings') renderSettings();
    window.scrollTo({ top: 0 });
  }
  function bindNav() {
    $$('#navSide .nav-item, #bottomNav button').forEach(b => b.onclick = () => switchView(b.dataset.nav));
    $('#btnLogout').onclick = async () => { await Store.signOut(); showAuth(); };
    $('#btnSideCollapse').onclick = toggleSidebar;
    $('#btnMenu').onclick = toggleSidebar;
    $('#scrim').onclick = closeDrawer;
    window.addEventListener('resize', applySidebar);
  }

  /* ================= 仪表盘 ================= */
  async function renderHome() {
    await renderCountdowns();
    await renderCheckin();
    await renderTasks();
    await renderCalendar();
    renderPomodoro();
    await renderRewards();
    await renderModuleTiles();
  }

  /* ================= 学习日历 ================= */
  const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
  const p2 = n => String(n).padStart(2, '0');
  const ISO = (y, m, d) => y + '-' + p2(m + 1) + '-' + p2(d);
  let calY = null, calM = null, calSel = null;
  let calTaskCache = [];
  let calReveal = false;

  function calCursor() {
    const now = new Date();
    if (calY === null) { calY = now.getFullYear(); calM = now.getMonth(); }
    if (!calSel) calSel = today();
  }

  async function renderCalendar() {
    calCursor();
    const t = today();
    $('#calMonth').textContent = calY + ' 年 ' + (calM + 1) + ' 月';
    $('#calHead').innerHTML = WEEK.map(w => `<div>${w}</div>`).join('');

    const checkins = await Store.listCheckins();
    const ck = {};
    checkins.forEach(c => { const d = String(c.date || '').slice(0, 10); if (d) ck[d] = true; });

    /* 整个月的任务一次拿回来，避免一天一次请求 */
    const first = ISO(calY, calM, 1);
    const lastDay = new Date(calY, calM + 1, 0).getDate();
    const last = ISO(calY, calM, lastDay);
    try { calTaskCache = await Store.listTasksRange(first, last); } catch (e) { calTaskCache = []; }
    const byDate = {};
    calTaskCache.forEach(x => { (byDate[x.date] = byDate[x.date] || []).push(x); });

    /* 网格：周一开头 */
    const jsFirst = new Date(calY, calM, 1).getDay();       // 0=周日
    const lead = (jsFirst + 6) % 7;
    let html = '';
    for (let i = 0; i < lead; i++) html += '<div class="cal-cell out"></div>';

    const monthSel = calSel.slice(0, 7) === ISO(calY, calM, 1).slice(0, 7);
    for (let d = 1; d <= lastDay; d++) {
      const iso = ISO(calY, calM, d);
      const isToday = iso === t;
      const isPast = iso < t;
      const list = byDate[iso] || [];
      const doneN = list.filter(x => x.done).length;

      let cls = 'cal-cell';
      if (ck[iso]) cls += ' ok';
      else if (isPast) cls += ' miss';
      if (isToday) cls += ' today';
      if (iso === calSel) cls += ' sel';

      let dots = '';
      if (list.length) {
        const show = Math.min(list.length, 5);
        for (let i = 0; i < show; i++) dots += `<i class="${i < doneN ? 'on' : ''}"></i>`;
        if (list.length > show) dots += `<i class="on"></i>`;
      }

      html += `<div class="${cls}" data-date="${iso}" role="button" tabindex="0" title="${iso}">
        <div class="cd">${d}</div>
        <div class="cdot">${dots}</div>
        ${list.length ? `<div class="ctasks">${list.length} 项${doneN === list.length ? ' · 全清' : ' · 完成' + doneN}</div>` : ''}
        <div class="cbar"></div>
      </div>`;
    }
    const tail = (7 - ((lead + lastDay) % 7)) % 7;
    for (let i = 0; i < tail; i++) html += '<div class="cal-cell out"></div>';
    $('#calGrid').innerHTML = html;

    $$('#calGrid .cal-cell[data-date]').forEach(b => {
      const go = () => { calSel = b.dataset.date; renderCalendar(); };
      b.onclick = go;
      b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });

    renderCalDay(ck);
  }

  async function renderCalDay(ckMap) {
    const iso = calSel || today();
    const t = today();
    let ck = ckMap;
    if (!ck) {
      const list = await Store.listCheckins();
      ck = {};
      list.forEach(c => { const d = String(c.date || '').slice(0, 10); if (d) ck[d] = true; });
    }
    const tasks = calTaskCache.filter(x => x.date === iso);
    const dayLabel = (() => {
      const [y, m, d] = iso.split('-').map(Number);
      const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
      return `${m} 月 ${d} 日 · 周${wd}` + (iso === t ? '（今天）' : '');
    })();
    const tag = ck[iso]
      ? '<span class="cal-day-tag ok">当天已打卡</span>'
      : (iso < t ? '<span class="cal-day-tag miss">当天没打卡</span>' : '<span class="cal-day-tag none">还没到</span>');

    $('#calDay').innerHTML = `
      <div class="cal-day-head">
        <div class="cal-day-title">${dayLabel}</div>
        ${tag}
      </div>
      ${tasks.length ? tasks.map(x => `
        <div class="task ${x.done ? 'done' : ''}">
          <input type="checkbox" ${x.done ? 'checked' : ''} data-tid="${x.id}" ${x.date !== t ? 'disabled' : ''}>
          <div class="task-body">
            <div class="task-title"><span class="tag b">${esc(modShort(x.module))}</span>${esc(x.title)}</div>
          </div>
        </div>`).join('')
        : '<div class="empty">这一天没有安排学习任务。</div>'}
      ${iso === t ? '' : '<div class="hint" style="margin-top:8px">只能勾选今天的任务，往日记录只做回顾。</div>'}`;

    $$('#calDay input[data-tid]').forEach(inp => inp.onchange = async e => {
      await Store.toggleTask(inp.dataset.tid, e.target.checked);
      await renderCalendar();
      await renderTasks();
    });
  }

  /* ================= 番茄钟 ================= */
  const POMO_KEY = 'cy_pomo_';
  const RING_LEN = 2 * Math.PI * 88;
  let pomo = {
    phase: 'focus',        // focus | break
    running: false,
    left: 25 * 60,
    total: 25 * 60,
    timer: null,
    focusMin: 25,
    breakMin: 5,
    count: 0
  };

  function pomoReadCount() {
    const n = Number(localStorage.getItem(POMO_KEY + today()));
    pomo.count = Number.isFinite(n) ? n : 0;
  }
  function pomoWriteCount() {
    localStorage.setItem(POMO_KEY + today(), String(pomo.count));
  }
  function pomoSetRing() {
    const p = pomo.total ? (pomo.total - pomo.left) / pomo.total : 0;
    const ring = $('#pomoRing');
    ring.style.strokeDasharray = RING_LEN.toFixed(1);
    ring.style.strokeDashoffset = (RING_LEN * (1 - p)).toFixed(1);
  }
  function pomoPaint() {
    const m = Math.floor(pomo.left / 60), s = pomo.left % 60;
    $('#pomoTime').textContent = m + ':' + p2(s);
    $('#pomoPhase').textContent = pomo.running
      ? (pomo.phase === 'focus' ? '专注中' : '休息中')
      : (pomo.phase === 'focus' ? '准备专注' : '准备休息');
    $('#pomoCount').textContent = pomo.count;
    $('#pomoStart').textContent = pomo.running ? '暂停' : (pomo.phase === 'focus' ? '开始专注' : '开始休息');
    $('#pomoWrap').classList.toggle('break', pomo.phase === 'break');
    $('#pomoWrap').classList.toggle('paused', !pomo.running);
    pomoSetRing();
  }
  function pomoStop() {
    if (pomo.timer) clearInterval(pomo.timer);
    pomo.timer = null;
    pomo.running = false;
    pomoPaint();
  }
  function pomoLoad(durMin) {
    pomo.total = Math.max(60, Math.round(durMin * 60));
    pomo.left = pomo.total;
  }
  function pomoBeep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 760;
      gain.gain.value = 0.001;
      osc.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.16, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc.start(now); osc.stop(now + 1);
      setTimeout(() => { try { ctx.close(); } catch (e) { } }, 1400);
    } catch (e) { /* 静音环境就算了 */ }
  }
  async function pomoFinish() {
    pomoStop();
    pomoBeep();
    if (pomo.phase === 'focus') {
      pomo.count++; pomoWriteCount();
      const gain = (SEED.POINTS_RULE && SEED.POINTS_RULE.pomodoro) || 2;
      try { await Store.addPoints(gain); await refreshUserChip(); } catch (e) { }
      $('#statPoints').textContent = Store.user().points || 0;
      toast('这一轮专注完成，+' + gain + ' 积分。休息一下吧。');
      pomo.phase = 'break';
      pomoLoad(pomo.breakMin);
    } else {
      const last = ($('#pomoTask').value || '').trim();
      toast('休息结束，回来接着干' + (last ? '：' + last : ''));
      pomo.phase = 'focus';
      pomoLoad(pomo.focusMin);
    }
    pomoPaint();
  }
  function pomoStart() {
    if (pomo.running) { pomoStop(); return; }
    pomo.focusMin = Math.min(180, Math.max(1, Number($('#pomoFocusMin').value) || 25));
    pomo.breakMin = Math.min(60, Math.max(1, Number($('#pomoBreakMin').value) || 5));
    /* 还没开始走（进度为 0）就按最新填的时长重新装一次；
       中途暂停（left < total）则原样接着走，不会被重置 */
    if (pomo.left === pomo.total) pomoLoad(pomo.phase === 'focus' ? pomo.focusMin : pomo.breakMin);
    pomo.running = true;
    pomo.timer = setInterval(() => {
      pomo.left--;
      if (pomo.left <= 0) { pomo.left = 0; pomoPaint(); pomoFinish(); return; }
      pomoPaint();
    }, 1000);
    pomoPaint();
  }
  async function renderPomodoro() {
    if (!$('#pomoTime')) return;
    pomoReadCount();
    if (!pomo.running && !pomo.timer) {
      pomo.focusMin = Math.min(180, Math.max(1, Number($('#pomoFocusMin').value) || 25));
      pomo.breakMin = Math.min(60, Math.max(1, Number($('#pomoBreakMin').value) || 5));
      pomo.phase = 'focus';
      pomoLoad(pomo.focusMin);
    }
    pomoPaint();
    /* 默认把今天第一条没做完的任务填进去，省得每次手打
       ⚠️ 本机模式下 listTasks 返回的是普通数组、云端模式下是 Promise，
       所以这里必须用 await（await 对非 Promise 也安全），不能直接 .then() */
    if (!$('#pomoTask').value) {
      try {
        const list = await Store.listTasks(today());
        const undone = (list || []).find(x => !x.done);
        if (undone && !$('#pomoTask').value) $('#pomoTask').value = undone.title;
      } catch (e) { /* 拿不到就算了，不影响计时 */ }
    }
  }

  async function renderCountdowns() {
    const exams = await Store.listExams();
    const box = $('#countdowns');
    box.innerHTML = exams.map(e => {
      const d = daysLeft(e.date);
      const txt = e.date ? (d >= 0 ? `${d}<small>天</small>` : `<span style="font-size:20px;color:#9DA4A1">已过</span>`) : `<span style="font-size:20px;color:#9DA4A1">待定</span>`;
      return `<div class="count-item" data-exam="${e.id}">
        <div class="count-edit">改日期</div>
        <div class="count-name">${esc(e.name)}</div>
        <div class="count-days">${txt}</div>
        <div class="count-date">${e.date ? fmtDate(e.date) : esc(e.note || '点右上角自定义')}</div>
      </div>`;
    }).join('') || '<div class="count-item"><div class="count-name">还没有考试</div></div>';
    $$('#countdowns .count-item').forEach(el => el.onclick = async () => {
      const id = el.dataset.exam; if (!id) return;
      const exams2 = await Store.listExams();
      const e = exams2.find(x => x.id === id); if (!e) return;
      const name = prompt('考试名称', e.name); if (name === null) return;
      const date = prompt('考试日期（YYYY-MM-DD，留空表示待定）', e.date || '');
      if (date === null) return;
      await Store.saveExam({ id: e.id, name, date: date.trim(), note: e.note || '' });
      renderCountdowns();
    });
  }

  async function renderCheckin() {
    const u = Store.user();
    const checkins = await Store.listCheckins();
    const doneToday = u.lastCheckin === today();
    $('#statStreak').textContent = u.streak || 0;
    $('#statPoints').textContent = u.points || 0;
    $('#statDays').textContent = checkins.length;
    const btn = $('#btnCheckin');
    btn.classList.toggle('done', doneToday);
    $('#checkinLabel').textContent = doneToday ? '已打卡' : '打卡';
    $('#checkinSub').textContent = doneToday ? '明天见' : '今天';
    $('#checkinHint').textContent = doneToday
      ? '今天已经签过到了。连续 ' + (u.streak || 0) + ' 天，稳住。'
      : '打卡 +' + SEED.POINTS_RULE.checkin + ' 分；当天任务全部完成再 +' + SEED.POINTS_RULE.allTasks + ' 分；连签满 7 天额外 +' + SEED.POINTS_RULE.week7 + ' 分。';
  }

  async function renderTasks() {
    const d = today();
    const tasks = await Store.listTasks(d);
    const done = tasks.filter(t => t.done).length;
    $('#taskProgress').textContent = tasks.length
      ? `已完成 ${done} / ${tasks.length}${done === tasks.length ? '，今天全部清空了' : ''}`
      : '还没有安排，先加一条吧';
    $('#taskList').innerHTML = tasks.length ? tasks.map(t => `
      <div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.done ? 'checked' : ''}>
        <div class="task-body">
          <div class="task-title"><span class="tag b">${esc(modShort(t.module))}</span>${esc(t.title)}</div>
        </div>
        <button class="task-del">删除</button>
      </div>`).join('') : '<div class="empty">今天还没有学习任务。加一条，或者点「从任务库选」。</div>';

    $$('#taskList .task').forEach(el => {
      el.querySelector('input').onchange = async e => {
        await Store.toggleTask(el.dataset.id, e.target.checked);
        await renderTasks();
        await renderCalendar();
      };
      el.querySelector('.task-del').onclick = async () => {
        await Store.delTask(el.dataset.id);
        await renderTasks();
        await renderCalendar();
      };
    });
  }

  async function renderRewards() {
    const u = Store.user();
    const rs = await Store.listRewards();
    $('#rewardList').innerHTML = rs.length ? rs.map(r => `
      <div class="reward ${r.redeemed ? 'redeemed' : ''}" data-id="${r.id}">
        <div>
          <div class="reward-name">${esc(r.title)}</div>
          <div class="reward-cost">${r.cost} 积分${r.redeemed ? ' · 已兑换' : ''}</div>
        </div>
        <div class="row">
          ${r.redeemed ? '<span class="tag g">已兑换</span>' : `<button class="btn soft sm" data-redeem>兑换</button>`}
          <button class="task-del" data-del>删除</button>
        </div>
      </div>`).join('') : '<div class="empty">还没有奖励。给自己定一个吧，积分才有意义。</div>';

    $$('#rewardList .reward').forEach(el => {
      const btn = el.querySelector('[data-redeem]');
      if (btn) btn.onclick = async () => {
        const r = await Store.redeemReward(el.dataset.id);
        toast(r.msg); await refreshUserChip(); renderRewards(); renderCheckin();
      };
      el.querySelector('[data-del]').onclick = async () => { await Store.delReward(el.dataset.id); renderRewards(); };
    });
  }

  async function renderModuleTiles() {
    const items = await Store.listItems({ kind: 'mindmap' });
    $('#moduleTiles').innerHTML = MODULES.map(m => {
      const mine = items.filter(i => i.module === m.id);
      return `<button class="mod-tile" data-mod="${m.id}">
        <div class="mt-name">${esc(m.name)}</div>
        <div class="mt-meta">${mine.length ? mine.length + ' 张导图' : '还没有导图，点开新建'}</div>
      </button>`;
    }).join('');
    $$('#moduleTiles .mod-tile').forEach(b => b.onclick = () => openReview(b.dataset.mod));
  }

  /* ================= 笔记 ================= */
  async function renderNotes() {
    const mod = $('#noteFilterModule').value;
    const kind = $('#noteFilterKind').value;
    const sort = $('#noteFilterSort').value;
    const me = Store.user();
    let items = await Store.listItems({ userId: me.id, kind: kind || undefined, module: mod || undefined });
    $('#noteCount').textContent = '共 ' + items.length + ' 条';
    if (!items.length) { $('#noteList').innerHTML = '<div class="empty">还没有内容，点右上角「新建笔记」开始。</div>'; return; }

    const card = i => {
      const excerpt = itemExcerpt(i, 160);
      return `<div class="note-card" data-id="${i.id}">
        <div class="note-title">${esc(i.title || '无标题')}</div>
        <div class="row wrap" style="gap:6px;margin-bottom:6px">
          <span class="tag b">${esc(modName(i.module))}</span>
          <span class="tag ${i.kind === 'mindmap' ? 'w' : ''}">${i.kind === 'mindmap' ? '思维导图' : '笔记'}</span>
          ${i.visibility === 'public' ? '<span class="tag">已发布</span>' : ''}
        </div>
        <div class="note-excerpt">${esc(excerpt)}</div>
        <div class="note-foot"><span>${esc(fmtDate(i.createdAt))}</span><span>${i.likes ? '♥ ' + i.likes.length : ''}</span></div>
      </div>`;
    };

    if (sort === 'module') {
      $('#noteList').innerHTML = MODULES.map(m => {
        const sub = items.filter(i => i.module === m.id);
        if (!sub.length) return '';
        return `<div class="card-head" style="margin:18px 0 10px"><div class="card-title">${esc(m.name)} <span class="card-sub">${sub.length} 条</span></div></div>
          <div class="waterfall">${sub.map(card).join('')}</div>`;
      }).join('');
    } else {
      $('#noteList').innerHTML = `<div class="waterfall">${items.map(card).join('')}</div>`;
    }
    $$('#noteList .note-card').forEach(el => el.onclick = async () => {
      const list = await Store.listItems({ userId: Store.user().id });
      const it = list.find(x => x.id === el.dataset.id);
      if (it) openEditor(it);
    });
  }

  /* ================= 瀑布流 ================= */
  async function renderForum() {
    const mod = $('#forumFilterModule').value;
    let items = await Store.listItems({ visibility: 'public', module: mod || undefined });
    if (Store.mode === 'local') {
      const all = await Store.listItems({ visibility: 'public' });
      items = all.filter(i => !mod || i.module === mod);
    }
    const me = Store.user();
    $('#forumList').innerHTML = items.length ? items.map(i => {
      const excerpt = itemExcerpt(i, 200);
      const liked = (i.likes || []).includes(me.id);
      return `<div class="note-card" data-id="${i.id}">
        <div class="note-title">${esc(i.title || '无标题')}</div>
        <div class="row wrap" style="gap:6px;margin-bottom:8px">
          <span class="tag b">${esc(modName(i.module))}</span>
          <span class="tag ${i.kind === 'mindmap' ? 'w' : ''}">${i.kind === 'mindmap' ? '思维导图' : '笔记'}</span>
        </div>
        <div class="note-excerpt">${esc(excerpt)}</div>
        <div class="note-foot">
          <span>${esc(i.authorName || '匿名')}</span>
          <span>${esc(fmtDate(i.createdAt))}</span>
          <span class="spacer"></span>
          <button class="btn ghost sm" data-like="${i.id}">${liked ? '♥' : '♡'} ${(i.likes || []).length}</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty">还没有人发布内容。你在「我的笔记」里把可见性改成「发布到瀑布流」就会出现在这里。</div>';

    $$('#forumList .note-card').forEach(el => el.onclick = async e => {
      if (e.target.dataset.like) return;
      const list = await Store.listItems();
      const it = list.find(x => x.id === el.dataset.id);
      if (it) openEditor(it);
    });
    $$('#forumList [data-like]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      await Store.toggleLike(b.dataset.like);
      renderForum();
    });
  }

  /* ================= 行测助手 ================= */
  let mulHidden = false;
  function buildMulTable() {
    let html = '<tr><th>×</th>' + Array.from({ length: 19 }, (_, i) => `<th>${i + 1}</th>`).join('') + '</tr>';
    for (let a = 1; a <= 19; a++) {
      html += `<tr><th>${a}</th>`;
      for (let b = 1; b <= 19; b++) html += `<td class="${mulHidden ? 'hid' : ''}" data-v="${a * b}">${a * b}</td>`;
      html += '</tr>';
    }
    $('#mulTable').innerHTML = html;
  }
  let quiz = { a: 0, b: 0, total: 0, right: 0 };
  function newQuiz() {
    quiz.a = 2 + Math.floor(Math.random() * 18);
    quiz.b = 2 + Math.floor(Math.random() * 18);
    $('#quizQ').textContent = quiz.a + ' × ' + quiz.b + ' = ?';
    $('#quizInput').value = ''; $('#quizFeedback').textContent = '';
  }
  function renderTools() {
    if (!$('#mulTable').innerHTML) buildMulTable();
    if (!$('#quizQ').textContent) newQuiz();
    $('#toolFormula').innerHTML = `<div class="mindmap">${renderTree(SEED.MINDMAPS.zlfx.root, 0, true)}</div>`;
    $('#toolTuitu').innerHTML = `<div class="mindmap">${renderTree(SEED.MINDMAPS.pdtl.root, 0, true)}</div>`;
    bindTreeToggles();
  }
  function bindTreeToggles() {
    $$('.mm-toggle[data-toggle]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const li = b.closest('.mm-node');
      const collapsed = li.classList.toggle('collapsed');
      b.textContent = collapsed ? '+' : '−';
    });
  }

  /* ================= 设置 ================= */
  async function renderSettings() {
    const u = Store.user();
    $('#setNick').textContent = u.nickname || '—';
    $('#setUser').textContent = u.username || '—';
    $('#setRole').textContent = u.role === 'admin' ? '管理员' : '学员';
    $('#setMode').textContent = Store.mode === 'cloud' ? '云端模式（多端同步）' : '本机模式（仅本设备）';
    $('#aboutText').innerHTML = '船员学习室 · 好好学习，天天向上<br>当前数据模式：' + (Store.mode === 'cloud' ? 'Supabase 云端' : '浏览器本地存储') +
      '<br>行测内容参考四海公考（花生十三）系统班课件整理，可自行增删改。';

    const invites = await Store.listInvites();
    $('#inviteList').innerHTML = invites.length ? invites.map(i =>
      `<div class="reward"><div><div class="reward-name" style="font-family:monospace">${esc(i.code)}</div>
        <div class="reward-cost">${i.usedBy ? '已被 ' + esc(i.usedBy) + ' 使用' : '未使用'}</div></div>
        <button class="btn ghost sm" data-copy="${esc(i.code)}">复制</button></div>`).join('')
      : '<div class="empty">还没有邀请码。点右上角生成一个发给同学。</div>';
    $$('#inviteList [data-copy]').forEach(b => b.onclick = () => {
      navigator.clipboard?.writeText(b.dataset.copy);
      toast('邀请码已复制：' + b.dataset.copy);
    });
  }

  /* ================= 编辑器 ================= */
  let editing = null, editTab = 'edit';
  async function openEditor(item, defaultKind) {
    if (item) {
      editing = Object.assign({}, item);
      editing.readOnly = false;
      if (editing.content == null) editing.content = '';
    } else {
      editing = { module: MODULES[0].id, kind: defaultKind || 'note', title: '', content: '', visibility: 'private' };
    }
    editTab = 'edit';
    $$('#editTabs button').forEach(b => b.classList.toggle('active', b.dataset.etab === 'edit'));
    $('#editor').classList.remove('hidden');
    drawEditor();
  }
  let mmCtrl = null, pvCtrl = null, imgTarget = null, pvRevealed = false;

  /* 把编辑器表单里的值同步回 editing。
     任何"重新渲染编辑器"的动作之前都要先调它，否则刚打的标题会被清空。 */
  function pullEditorForm() {
    if (!editing) return;
    if ($('#edTitle')) {
      editing.title = $('#edTitle').value;
      editing.module = $('#edModule').value;
      editing.kind = $('#edKind').value;
      editing.visibility = $('#edVis').value;
    }
    if (mmCtrl) editing.content = mmCtrl.serialize();
    else if ($('#edContent')) editing.content = $('#edContent').value;
  }

  function editorHead(it) {
    return `
      <div class="field"><label>标题（也是瀑布流里显示的「主题」）</label>
        <input class="input" id="edTitle" value="${esc(it.title)}" placeholder="例如：资料分析 · 增长率速算口诀"></div>
      <div class="grid g3">
        <div class="field"><label>模块</label><select class="input" id="edModule">${MODULES.map(m => `<option value="${m.id}" ${m.id === it.module ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field"><label>类型</label><select class="input" id="edKind">
          <option value="note" ${it.kind === 'note' ? 'selected' : ''}>笔记（纯文字）</option>
          <option value="mindmap" ${it.kind === 'mindmap' ? 'selected' : ''}>思维导图（图形）</option>
        </select></div>
        <div class="field"><label>可见性</label><select class="input" id="edVis">
          <option value="private" ${it.visibility !== 'public' ? 'selected' : ''}>仅自己可见</option>
          <option value="public" ${it.visibility === 'public' ? 'selected' : ''}>发布到瀑布流</option>
        </select></div>
      </div>`;
  }

  function mapToolsHtml() {
    return `
      <div class="mmc-tools">
        <button class="btn soft sm" id="mmAddChild">＋ 子节点</button>
        <button class="btn ghost sm" id="mmAddSib">＋ 同级</button>
        <button class="btn ghost sm" id="mmAddFree">＋ 自由节点</button>
        <button class="btn ghost sm" id="mmDel">删除节点</button>
        <span class="spacer"></span>
        <button class="btn ghost sm" id="mmImg">插入图片</button>
        <button class="btn ghost sm" id="mmWide">长文本节点</button>
        <button class="btn ghost sm" id="mmImport">大纲导入</button>
      </div>
      <div class="mmc-outline-box hidden" id="mmOutlineBox">
        <textarea class="input" id="mmOutlineText" placeholder="把大纲粘进来：每行一条，行首缩进两个空格 ＝ 下一级"></textarea>
        <div class="row wrap" style="margin-top:8px">
          <button class="btn soft sm" id="mmOutlineOk">生成导图</button>
          <button class="btn ghost sm" id="mmOutlineCancel">取消</button>
          <span class="hint">会替换掉现在这张图（图里的图片会一起没，谨慎用）</span>
        </div>
      </div>
      <div class="mmc-stage" id="mmStage"></div>
      <div class="mmc-tools" style="margin-top:10px">
        <button class="btn ghost sm" id="mmOut">缩小 −</button>
        <span class="hint" id="mmZoom">100%</span>
        <button class="btn ghost sm" id="mmIn">放大 ＋</button>
        <button class="btn ghost sm" id="mmLayout">整理布局</button>
        <button class="btn ghost sm" id="mmFit">适应屏幕</button>
      </div>
      <div class="mmc-insp">
        <div class="field" style="margin-bottom:0">
          <label>选中节点的文字（一整道例题也能塞进来，换行随便打）</label>
          <textarea class="input" id="mmText" placeholder="先点画布上的某个节点，或者点「＋ 子节点」新建一个"></textarea>
        </div>
      </div>
      <div class="mmc-hint">拖节点＝移动　拖空白＝平移　滚轮＝缩放　双击节点＝跳到下面的输入框</div>
      <input type="file" id="mmImgFile" accept="image/*" class="hidden">`;
  }

  function mountMapEditor() {
    const graph = MIND.parse(editing.content || '');
    if (!graph.nodes.length) graph.nodes = MIND.blank().nodes;

    const syncInsp = id => {
      const ta = $('#mmText'); if (!ta) return;
      const n = graph.nodes.find(x => x.id === id);
      ta.value = n ? n.t : '';
      ta.disabled = !n;
    };
    mmCtrl = MIND.mount($('#mmStage'), graph, {
      onSelect: syncInsp,
      onDblClick: () => { const ta = $('#mmText'); if (ta) ta.focus(); }
    });
    syncInsp(null);

    const bump = () => { const z = $('#mmZoom'); if (z) z.textContent = mmCtrl.zoomLevel() + '%'; };

    $('#mmAddChild').onclick = () => { mmCtrl.addChild(null); syncInsp(mmCtrl.selectedId()); };
    $('#mmAddSib').onclick = () => { mmCtrl.addSibling(null); syncInsp(mmCtrl.selectedId()); };
    $('#mmAddFree').onclick = () => { mmCtrl.addFree(); syncInsp(mmCtrl.selectedId()); };
    $('#mmDel').onclick = () => {
      if (!mmCtrl.selectedId()) return toast('先点一个节点，再删');
      mmCtrl.delSel(); syncInsp(null);
    };
    $('#mmWide').onclick = () => {
      const id = mmCtrl.selectedId();
      if (!id) return toast('先点一个节点');
      const n = mmCtrl.graph.nodes.find(x => x.id === id);
      mmCtrl.setWide(id, !(n && n.wide));
      toast(n && n.wide ? '已变回普通节点' : '已变成宽节点，适合放例题');
      bump();
    };
    $('#mmImg').onclick = () => {
      const id = mmCtrl.selectedId() || mmCtrl.addChild(null, '图片');
      imgTarget = id;
      $('#mmImgFile').click();
    };
    $('#mmImgFile').onchange = async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f || !imgTarget) return;
      try {
        toast('正在压缩图片……');
        const r = await MIND.compressImage(f, 800);
        mmCtrl.setImage(imgTarget, r.dataUrl);
        bump();
        toast('图片已压到 ' + r.w + '×' + r.h + ' 插进导图');
      } catch (err) { toast(err.message || '这张图处理不了'); }
    };
    $('#mmText').oninput = e => {
      const id = mmCtrl.selectedId(); if (!id) return;
      mmCtrl.retext(id, e.target.value);
    };
    $('#mmOut').onclick = () => { mmCtrl.zoomBy(1 / 1.15); bump(); };
    $('#mmIn').onclick = () => { mmCtrl.zoomBy(1.15); bump(); };
    $('#mmFit').onclick = () => { mmCtrl.fit(); bump(); };
    $('#mmLayout').onclick = () => { mmCtrl.autoLayout(); bump(); toast('已重新排布'); };
    $('#mmImport').onclick = () => $('#mmOutlineBox').classList.toggle('hidden');
    $('#mmOutlineCancel').onclick = () => $('#mmOutlineBox').classList.add('hidden');
    $('#mmOutlineOk').onclick = () => {
      const txt = $('#mmOutlineText').value;
      if (!txt.trim()) return toast('先粘点东西进来');
      pullEditorForm();                    // ← 先保住标题等已填内容，否则重绘会清空
      editing.content = MIND.serialize(MIND.fromIndentText(txt));
      drawEditor();
      toast('已按大纲生成导图，可以接着拖');
    };

    window.setTimeout(() => { mmCtrl.fit(); bump(); }, 40);
  }

  function drawEditor() {
    const it = editing;
    const isNew = !it.id;
    const canEdit = !it.readOnly;
    const isMap = it.kind === 'mindmap';
    if (mmCtrl) { mmCtrl.destroy(); mmCtrl = null; }
    if (pvCtrl) { pvCtrl.destroy(); pvCtrl = null; }
    imgTarget = null;

    if (editTab === 'edit') {
      if (isMap) {
        $('#editorBody').innerHTML = editorHead(it) + mapToolsHtml();
        mountMapEditor();
      } else {
        const plain = (MIND.isGraph(it.content) || MIND.isOutline(it.content))
          ? MIND.toOutlineText(MIND.parse(it.content), true)
          : (it.content || '');
        $('#editorBody').innerHTML = editorHead(it) + `
          <div class="field"><label>正文</label>
            <textarea class="input" id="edContent" style="min-height:320px" placeholder="记下今天真正弄懂的那一点">${esc(plain)}</textarea>
            <div class="hint" style="margin-top:6px">想手动指定挖空位置？把要挖的内容写成【【这样】】即可。</div>
          </div>`;
      }
    } else if (editTab === 'preview') {
      const tagRow = `<div class="row wrap" style="gap:6px;margin-bottom:12px">
          <span class="tag b">${esc(modName(it.module))}</span>
          <span class="tag ${isMap ? 'w' : ''}">${isMap ? '思维导图' : '笔记'}</span>
          ${it.visibility === 'public' ? '<span class="tag">已发布</span>' : ''}
        </div>`;
      if (isMap) {
        $('#editorBody').innerHTML = `
          <div class="note-title" style="font-size:18px;margin-bottom:6px">${esc(it.title || '无标题')}</div>
          ${tagRow}
          <div class="row wrap" style="gap:8px;margin-bottom:10px">
            <button class="btn ghost sm" id="pvReveal">默写模式：盖住文字</button>
            <button class="btn ghost sm" id="pvFit">适应屏幕</button>
            <span class="hint" id="pvStat"></span>
          </div>
          <div class="mmc-stage review-map" id="pvStage"></div>`;
        pvRevealed = false;
        pvCtrl = MIND.mount($('#pvStage'), MIND.parse(it.content), {
          readonly: true,
          onReveal: () => {
            const s = pvCtrl.revealStats();
            $('#pvStat').textContent = '已揭晓 ' + s.revealed + ' / ' + s.total + ' 个节点';
          }
        });
        pvCtrl.fit();
        window.setTimeout(() => { if (pvCtrl) pvCtrl.fit(); }, 60);
        $('#pvReveal').onclick = () => {
          pvRevealed = !pvRevealed;
          pvCtrl.setRevealMode(pvRevealed);
          $('#pvReveal').textContent = pvRevealed ? '退出默写模式' : '默写模式：盖住文字';
          $('#pvStat').textContent = pvRevealed ? '点节点逐个揭晓：已揭晓 0 / ' + pvCtrl.revealStats().total : '';
        };
        $('#pvFit').onclick = () => pvCtrl.fit();
      } else {
        $('#editorBody').innerHTML = `
          <div class="note-title" style="font-size:18px;margin-bottom:6px">${esc(it.title || '无标题')}</div>
          ${tagRow}
          <div style="white-space:pre-wrap;font-size:15px;line-height:1.9">${esc(it.content)}</div>`;
      }
    } else {
      const plain = isMap ? MIND.toOutlineText(MIND.parse(it.content), true) : (it.content || '');
      $('#editorBody').innerHTML = `
        <div class="row wrap" style="margin-bottom:14px">
          <span class="hint">挖空方式</span>
          <select class="input" id="rcMode" style="width:auto">
            <option value="auto">只挖公式/分点后面的答案</option>
            <option value="tail">每行都挖末尾几个字</option>
            <option value="manual">只挖我标了【【】】的地方</option>
          </select>
          <input class="input" id="rcTail" type="number" value="4" min="2" max="12" style="width:80px">
          <button class="btn ghost sm" id="btnReBuild">重新出题</button>
          <span class="spacer"></span>
          <button class="btn soft sm" id="btnReCheck">对答案</button>
        </div>
        ${isMap ? '<div class="hint" style="margin-bottom:10px">导图的默写按节点层级展开成文字，所以能挖公式、也能挖关键句。</div>' : ''}
        <div class="blanks" id="reciteBox"></div>
        <div id="reciteResult" style="margin-top:16px"></div>`;
      const rebuild = () => {
        const mode = $('#rcMode').value, n = $('#rcTail').value;
        const segs = buildRecite(plain, mode, n);
        let idx = 0, html = '';
        segs.forEach(line => line.forEach(s => {
          if (s.type === 't') html += esc(s.v).replace(/\n/g, '<br>');
          else html += `<input class="blank" data-i="${idx++}" data-ans="${esc(s.v)}" style="width:${Math.max(80, s.v.length * 15)}px">`;
        }));
        $('#reciteBox').innerHTML = html;
        $('#reciteResult').innerHTML = '';
      };
      $('#btnReBuild').onclick = rebuild;
      $('#btnReCheck').onclick = () => checkRecite();
      rebuild();
    }

    /* 底部按钮 */
    if (editTab === 'edit') {
      $('#editorFoot').innerHTML = `${canEdit || isNew ? `<button class="btn" id="btnSave">保存</button>` : ''}
        ${!isNew ? `<button class="btn ghost" id="btnCopy">跳到默写</button>` : ''}
        ${!isNew ? `<button class="btn danger" id="btnDel">删除</button>` : ''}`;
      const sv = $('#btnSave'); if (sv) sv.onclick = saveEditor;
      const cp = $('#btnCopy'); if (cp) cp.onclick = () => {
        if (mmCtrl) editing.content = mmCtrl.serialize();
        editTab = 'recite'; $$('#editTabs button').forEach(b => b.classList.toggle('active', b.dataset.etab === 'recite')); drawEditor();
      };
      const dl = $('#btnDel'); if (dl) dl.onclick = async () => {
        if (!confirm('确定删除这条内容？删了就找不回来了。')) return;
        await Store.delItem(it.id); closeEditor(); renderNotes();
      };
    } else if (editTab === 'preview') {
      $('#editorFoot').innerHTML = '<button class="btn ghost" id="btnToEdit">回到编辑</button>';
      $('#btnToEdit').onclick = () => { editTab = 'edit'; $$('#editTabs button').forEach(b => b.classList.toggle('active', b.dataset.etab === 'edit')); drawEditor(); };
    } else {
      $('#editorFoot').innerHTML = '<span class="hint">默写正确率 ≥ 90% 可以拿 ' + SEED.POINTS_RULE.recite90 + ' 积分（每天每条笔记一次）。</span><span class="spacer"></span><button class="btn ghost" id="btnToEdit2">回到编辑</button>';
      $('#btnToEdit2').onclick = () => { editTab = 'edit'; $$('#editTabs button').forEach(b => b.classList.toggle('active', b.dataset.etab === 'edit')); drawEditor(); };
    }
  }

  async function saveEditor() {
    const title = ($('#edTitle') ? $('#edTitle').value : (editing.title || '')).trim();
    const kind = $('#edKind') ? $('#edKind').value : editing.kind;
    if (!title) return toast('先给个标题');
    const u = Store.user();
    const rawText = $('#edContent') ? $('#edContent').value : '';
    let data;
    if (kind === 'mindmap') {
      data = mmCtrl
        ? mmCtrl.serialize()
        : MIND.serialize(MIND.parse(rawText || editing.content || ''));
    } else {
      data = mmCtrl
        ? MIND.toOutlineText(MIND.parse(mmCtrl.serialize()), true)
        : (rawText || editing.content || '');
    }
    const payload = {
      id: editing.id,
      userId: editing.userId || u.id,
      authorName: editing.authorName && editing.authorName !== '系统预置' ? editing.authorName : (u.nickname || u.username),
      module: $('#edModule') ? $('#edModule').value : editing.module,
      kind, title, content: data,
      visibility: $('#edVis') ? $('#edVis').value : editing.visibility
    };
    try {
      await Store.saveItem(payload);
    } catch (err) {
      toast(err.message || '保存失败：可能是浏览器本地存储满了，先导出备份再删几条带大图的笔记');
      return;
    }
    toast('已保存');
    closeEditor();
    if (view === 'notes') renderNotes();
    if (view === 'forum') renderForum();
    if (view === 'home') { renderModuleTiles(); renderCalendar(); }
  }
  function checkRecite() {
    const inputs = $$('#reciteBox .blank');
    let total = 0, right = 0;
    inputs.forEach(inp => {
      const ans = inp.dataset.ans, val = inp.value;
      total++;
      const ok = clean(val) === clean(ans);
      if (ok) { right++; inp.classList.add('ok'); inp.classList.remove('bad'); }
      else { inp.classList.add('bad'); inp.classList.remove('ok'); }
      let next = inp.nextElementSibling;
      if (next && next.dataset && next.dataset.diff) next.remove();
      if (!ok) {
        const div = document.createElement('div');
        div.dataset.diff = '1';
        div.style.width = '100%';
        div.innerHTML = diffHtml(val, ans);
        inp.insertAdjacentElement('afterend', div);
      }
    });
    const acc = total ? Math.round(right / total * 100) : 0;
    $('#reciteResult').innerHTML = `<div class="card" style="margin:0"><div class="card-title">正确率 ${acc}%（${right} / ${total}）</div>
      <div class="hint">${acc >= 90 ? '这个掌握得不错，可以往下走了。' : '错的地方再看一眼原文，然后重来一遍。'}</div></div>`;
    if (acc >= 90 && total) {
      const key = 'cy_recite_' + today() + '_' + (editing.id || 'new');
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        Store.addPoints(SEED.POINTS_RULE.recite90).then(refreshUserChip);
        toast('默写优秀，+' + SEED.POINTS_RULE.recite90 + ' 积分');
      }
    }
  }
  function closeEditor() {
    if (mmCtrl) { mmCtrl.destroy(); mmCtrl = null; }
    if (pvCtrl) { pvCtrl.destroy(); pvCtrl = null; }
    $('#editor').classList.add('hidden');
    editing = null;
  }
  function closeReview() {
    reviewCtrls.forEach(c => { try { c.destroy(); } catch (e) { } });
    reviewCtrls = [];
    $('#reviewModal').classList.add('hidden');
  }

  /* ================= 知识点复习弹层 ================= */
  let reviewCtrls = [];
  async function openReview(moduleId) {
    reviewCtrls.forEach(c => { try { c.destroy(); } catch (e) { } });
    reviewCtrls = [];
    const items = await Store.listItems({ kind: 'mindmap', module: moduleId });
    $('#reviewTabs').innerHTML = MODULES.map(m => `<button data-rm="${m.id}" class="${m.id === moduleId ? 'active' : ''}">${esc(m.short)}</button>`).join('');
    const box = $('#reviewBody');
    if (!items.length) {
      const hasSeed = !!SEED.MINDMAPS[moduleId];
      box.innerHTML = '<div class="empty">这个模块还没有导图。'
        + (hasSeed ? '<button class="btn soft sm" id="btnSeedThis" style="margin-left:8px">载入预置内容</button>' : '点「打开编辑」前先去「我的笔记 → 新建导图」画一张。')
        + '</div>';
      if ($('#btnSeedThis')) $('#btnSeedThis').onclick = async () => {
        const seed = SEED.MINDMAPS[moduleId];
        const u = Store.user();
        await Store.saveItem({ userId: u.id, authorName: '系统预置', module: moduleId, kind: 'mindmap', title: seed.title, content: JSON.stringify(seed.root), visibility: 'private' });
        openReview(moduleId); renderModuleTiles();
      };
    } else {
      box.innerHTML = items.map(i => `
        <div style="margin-bottom:26px">
          <div class="card-head">
            <div class="card-title">${esc(i.title)}</div>
            <button class="btn ghost sm" data-open="${i.id}">打开编辑</button>
          </div>
          <div class="mmc-stage review-map" data-graph="${i.id}"></div>
        </div>`).join('');

      $$('#reviewBody [data-graph]').forEach(st => {
        const it = items.find(x => x.id === st.dataset.graph);
        if (!it) return;
        try {
          const c = MIND.mount(st, MIND.parse(it.content), { readonly: true });
          reviewCtrls.push(c);
          c.fit();
          window.setTimeout(() => c.fit(), 80);
        } catch (e) {
          st.innerHTML = '<div class="mmc-empty">这张导图读不出来。</div>';
        }
      });

      $$('#reviewBody [data-open]').forEach(b => b.onclick = async () => {
        const list = await Store.listItems();
        const it = list.find(x => x.id === b.dataset.open);
        closeReview();
        if (it) openEditor(it);
      });
    }
    $$('#reviewTabs button').forEach(b => b.onclick = () => openReview(b.dataset.rm));
    $('#reviewModal').classList.remove('hidden');
  }

  /* ================= 绑定 ================= */
  function bindHome() {
    $('#btnCheckin').onclick = async () => {
      const r = await Store.doCheckin();
      toast(r.msg);
      if (r.ok) { await refreshUserChip(); renderHome(); }
    };
    $('#btnAddTask').onclick = async () => {
      const title = $('#taskTitle').value.trim();
      if (!title) return toast('先写点什么');
      await Store.addTask({ date: today(), module: $('#taskModule').value, title });
      $('#taskTitle').value = '';
      await renderTasks();
      await renderCalendar();
    };
    $('#taskTitle').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnAddTask').click(); });
    $('#btnTaskLib').onclick = () => {
      const box = $('#taskLibBox');
      box.classList.toggle('hidden');
      $('#taskLibList').innerHTML = SEED.TASK_LIBRARY.map((t, i) =>
        `<button class="btn ghost sm" data-lib="${i}">${esc(modShort(t.module))} · ${esc(t.title.replace(/^[^·]*·\s*/, ''))}</button>`).join('');
      $$('#taskLibList [data-lib]').forEach(b => b.onclick = async () => {
        const t = SEED.TASK_LIBRARY[Number(b.dataset.lib)];
        await Store.addTask({ date: today(), module: t.module, title: t.title });
        toast('已加入今日任务');
        await renderTasks();
        await renderCalendar();
      });
    };
    /* ---- 日历 ---- */
    $('#calPrev').onclick = () => {
      calM--; if (calM < 0) { calM = 11; calY--; }
      renderCalendar();
    };
    $('#calNext').onclick = () => {
      calM++; if (calM > 11) { calM = 0; calY++; }
      renderCalendar();
    };
    $('#calToday').onclick = () => {
      const now = new Date();
      calY = now.getFullYear(); calM = now.getMonth(); calSel = today();
      renderCalendar();
    };

    /* ---- 番茄钟 ---- */
    $('#pomoStart').onclick = pomoStart;
    $('#pomoReset').onclick = () => {
      pomoStop();
      pomo.phase = 'focus';
      pomo.focusMin = Math.min(180, Math.max(1, Number($('#pomoFocusMin').value) || 25));
      pomoLoad(pomo.focusMin);
      pomoPaint();
    };
    $('#pomoSkip').onclick = () => {
      pomoStop();
      pomo.phase = pomo.phase === 'focus' ? 'break' : 'focus';
      pomoLoad(pomo.phase === 'focus'
        ? Math.min(180, Math.max(1, Number($('#pomoFocusMin').value) || 25))
        : Math.min(60, Math.max(1, Number($('#pomoBreakMin').value) || 5)));
      pomoPaint();
    };
    $$('#pomoPresets button').forEach(b => b.onclick = () => {
      pomoStop();
      $('#pomoFocusMin').value = b.dataset.focus;
      $('#pomoBreakMin').value = b.dataset.break;
      pomo.focusMin = Number(b.dataset.focus);
      pomo.breakMin = Number(b.dataset.break);
      pomo.phase = 'focus';
      pomoLoad(pomo.focusMin);
      pomoPaint();
      toast('已设为专注 ' + b.dataset.focus + ' 分钟 / 休息 ' + b.dataset.break + ' 分钟');
    });
    $('#pomoFocusMin').onchange = () => {
      if (pomo.running || pomo.phase !== 'focus') return;
      pomoStop();
      pomo.focusMin = Math.min(180, Math.max(1, Number($('#pomoFocusMin').value) || 25));
      pomoLoad(pomo.focusMin);
      pomoPaint();
    };
    $('#pomoBreakMin').onchange = () => {
      pomo.breakMin = Math.min(60, Math.max(1, Number($('#pomoBreakMin').value) || 5));
    };

    $('#btnAddReward').onclick = () => $('#rewardForm').classList.toggle('hidden');    $('#btnSaveReward').onclick = async () => {
      const t = $('#rewardTitle').value.trim(), c = Number($('#rewardCost').value) || 100;
      if (!t) return toast('奖励叫什么？');
      await Store.addReward(t, c);
      $('#rewardTitle').value = ''; $('#rewardForm').classList.add('hidden');
      renderRewards(); toast('奖励已添加');
    };
    $('#btnNewNote').onclick = () => openEditor(null, 'note');
    $('#btnNewMind').onclick = () => openEditor(null, 'mindmap');
    ['#noteFilterModule', '#noteFilterKind', '#noteFilterSort'].forEach(s => $(s).onchange = renderNotes);
    $('#forumFilterModule').onchange = renderForum;
    $$('#toolTabs button').forEach(b => b.onclick = () => {
      $$('#toolTabs button').forEach(x => x.classList.toggle('active', x === b));
      ['mul', 'quiz', 'formula', 'tuitu'].forEach(k => $('#tool' + k[0].toUpperCase() + k.slice(1)).classList.toggle('hidden', k !== b.dataset.tool));
    });
    $('#btnMulHide').onclick = () => { mulHidden = true; buildMulTable(); };
    $('#btnMulShow').onclick = () => { mulHidden = false; buildMulTable(); };
    $('#mulTable').addEventListener('click', e => {
      if (e.target.tagName === 'TD') e.target.classList.toggle('hit');
    });
    $('#btnQuizCheck').onclick = () => {
      const v = Number($('#quizInput').value);
      if (!$('#quizInput').value) return;
      quiz.total++;
      if (v === quiz.a * quiz.b) { quiz.right++; $('#quizFeedback').textContent = '对'; setTimeout(newQuiz, 420); }
      else $('#quizFeedback').textContent = '应该是 ' + (quiz.a * quiz.b);
      $('#quizStat').textContent = '共 ' + quiz.total + ' 题 / 正确 ' + quiz.right + ' 题';
    };
    $('#quizInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnQuizCheck').click(); });
    $('#btnQuizNext').onclick = newQuiz;
    $('#btnNewInvite').onclick = async () => {
      const code = await Store.createInvite();
      $('#inviteMsg').className = 'msg ok'; $('#inviteMsg').textContent = '新邀请码：' + code;
      renderSettings();
    };
    $('#btnExport').onclick = () => {
      const blob = new Blob([Store.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '船员学习室备份_' + today() + '.json';
      a.click();
      toast('已导出备份文件');
    };
    $('#btnImport').onclick = () => $('#importFile').click();
    $('#importFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { Store.importAll(r.result); toast('导入成功，即将刷新'); setTimeout(() => location.reload(), 900); } catch (err) { toast('文件读不了：' + err.message); } };
      r.readAsText(f);
    };
    $('#btnEditClose').onclick = closeEditor;
    $('#btnReviewClose').onclick = closeReview;
    $$('#editTabs button').forEach(b => b.onclick = () => {
      if (b.dataset.etab !== 'edit' && editTab === 'edit') pullEditorForm();
      editTab = b.dataset.etab;
      $$('#editTabs button').forEach(x => x.classList.toggle('active', x === b));
      drawEditor();
    });
  }

  /* ================= 启动 ================= */
  (async function boot() {
    fillModuleSelect($('#taskModule'), false);
    fillModuleSelect($('#noteFilterModule'), true);
    fillModuleSelect($('#forumFilterModule'), true);
    bindAuth(); bindNav(); bindHome();
    try {
      const u = await Store.init();
      if (u) await enterApp(); else showAuth();
    } catch (e) {
      console.error(e); showAuth();
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  })();
})();
