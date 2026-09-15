/* 船员学习室 · 卡片记忆模块
 *
 * 数据照样存在 items 表里（kind='deck'，content 是 JSON），所以不用改数据库结构。
 * content = { cat, desc, seedId, cards:[ {id, f, b, tag, box, due, seen, right, wrong, last} ] }
 *
 * 复习算法用简化的 Leitner 盒：
 *   记得 → 盒号 +1，下次复习间隔 1/2/4/7/15/30 天
 *   模糊 → 盒号 -1，明天再看
 *   忘了 → 回到 0 号盒，本轮再出现一次
 *
 * 对外接口：window.CY_CARDS = { init, render, openStudy, openEditor }
 */
(function () {
  const Store = window.CY.Store;
  const SEED = window.CY_SEED;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad2 = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const BOX_DAYS = [0, 1, 2, 4, 7, 15, 30];
  const MASTER_BOX = 4;
  const CATS = ['申论规范词', '申论背诵素材', '申论对策', '政治理论', '常识科普', '自定义'];

  let decks = [];            // 原始 items
  let session = null;
  let editing = null;        // { item, draft }

  /* ---------------- 工具 ---------------- */
  function parseDeck(item) {
    let o = null;
    try { o = JSON.parse(item.content); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') o = {};
    if (!Array.isArray(o.cards)) o.cards = [];
    o.cat = o.cat || '自定义';
    o.desc = o.desc || '';
    o.cards = o.cards.map(c => ({
      id: c.id || uid(),
      f: c.f == null ? '' : String(c.f),
      b: c.b == null ? '' : String(c.b),
      tag: c.tag || '',
      box: Number.isFinite(c.box) ? c.box : 0,
      due: c.due || today(),
      seen: c.seen || 0,
      right: c.right || 0,
      wrong: c.wrong || 0,
      hard: c.hard || 0,
      last: c.last || ''
    }));
    return o;
  }
  const isDue = c => !c.due || c.due <= today();
  const isNew = c => !c.seen;
  const isMastered = c => (c.box || 0) >= MASTER_BOX;

  function dueCount(d) { return d.cards.filter(isDue).length; }
  function newCount(d) { return d.cards.filter(isNew).length; }
  function masterCount(d) { return d.cards.filter(isMastered).length; }

  function modName(id) {
    const m = (SEED.MODULES || []).find(x => x.id === id);
    return m ? m.short || m.name : (id || '其他');
  }

  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- 读取 ---------------- */
  async function load() {
    const u = Store.user();
    decks = await Store.listItems({ userId: u.id, kind: 'deck' });
    decks.forEach(d => { d._deck = parseDeck(d); });
    return decks;
  }

  async function persist(item) {
    const d = item._deck;
    const content = JSON.stringify({ cat: d.cat, desc: d.desc, seedId: d.seedId, cards: d.cards });
    const u = Store.user();
    const res = await Store.saveItem({
      id: item.id, userId: item.userId || u.id,
      authorName: item.authorName || u.nickname || u.username,
      module: item.module, kind: 'deck',
      title: item.title, content,
      visibility: item.visibility || 'private'
    });
    /* 本机模式返回的是整条记录，云端模式返回的是 id 字符串，两种都要接住 */
    if (!item.id) {
      if (typeof res === 'string') item.id = res;
      else if (res && res.id) item.id = res.id;
    }
    item.content = content;
    return item;
  }

  /* ---------------- 主页面 ---------------- */
  async function render() {
    const root = $('#cardsRoot');
    if (!root) return;
    await load();

    const total = decks.reduce((n, d) => n + d._deck.cards.length, 0);
    const due = decks.reduce((n, d) => n + dueCount(d._deck), 0);
    const mastered = decks.reduce((n, d) => n + masterCount(d._deck), 0);
    const news = decks.reduce((n, d) => n + newCount(d._deck), 0);

    const groups = {};
    decks.forEach(d => { (groups[d._deck.cat] = groups[d._deck.cat] || []).push(d); });

    root.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">卡片记忆</div>
            <div class="card-sub">先回忆，再翻面。忘了的会自动挑回来重来。</div>
          </div>
          <div class="row wrap">
            <button class="btn ghost sm" id="ckImport">上传内容</button>
            <button class="btn ghost sm" id="ckNew">新建卡片组</button>
            ${due ? `<button class="btn" id="ckStudyAll">复习今日（${due}）</button>` : ''}
          </div>
        </div>
        <div class="grid g4 ck-stats">
          <div class="ck-stat"><div class="ck-stat-n">${total}</div><div class="ck-stat-l">卡片总数</div></div>
          <div class="ck-stat"><div class="ck-stat-n brand">${due}</div><div class="ck-stat-l">今天该复习</div></div>
          <div class="ck-stat"><div class="ck-stat-n">${news}</div><div class="ck-stat-l">还没见过</div></div>
          <div class="ck-stat"><div class="ck-stat-n">${mastered}</div><div class="ck-stat-l">已掌握</div></div>
        </div>
        <div class="hint" style="margin-top:12px">忘了的卡今天会再出现一次；记得的按 1→2→4→7→15→30 天往后推。一天走完一轮 +${(SEED.POINTS_RULE && SEED.POINTS_RULE.cardRound) || 3} 积分。</div>
      </div>

      ${decks.length ? Object.keys(groups).map(cat => `
        <div class="ck-group">
          <div class="ck-group-head">
            <span class="ck-group-name">${esc(cat)}</span>
            <span class="hint">${groups[cat].length} 组 · ${groups[cat].reduce((n, d) => n + d._deck.cards.length, 0)} 张 · 待复习 ${groups[cat].reduce((n, d) => n + dueCount(d._deck), 0)}</span>
            <span class="spacer"></span>
            <button class="btn ghost sm" data-study-cat="${esc(cat)}">复习这一组</button>
          </div>
          ${groups[cat].map(deckRow).join('')}
        </div>`).join('')
        : '<div class="card"><div class="empty">还没有卡片组。用「新建卡片组」自己加，或者从下面的「预置卡片库」一键载入。<br>（你的课件内容我已经整理好了，在下面）</div></div>'}

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">预置卡片库</div>
            <div class="card-sub">从你的课件里抽出来的，点「载入」就变成你自己的卡片组，可以随便改</div>
          </div>
          <button class="btn ghost sm" id="ckToggleSeed">展开 / 收起</button>
        </div>
        <div id="ckSeedBox" class="hidden"></div>
      </div>`;

    $$('#cardsRoot [data-deck]').forEach(el => {
      const id = el.dataset.deck;
      el.querySelector('[data-act="study"]').onclick = () => openStudy([id]);
      el.querySelector('[data-act="edit"]').onclick = () => openEditor(id);
      el.querySelector('[data-act="del"]').onclick = async () => {
        const d = decks.find(x => x.id === id);
        if (!confirm(`确定删除卡片组「${d.title}」？里面 ${d._deck.cards.length} 张卡一起没。`)) return;
        await Store.delItem(id);
        toast('已删除'); render();
      };
    });
    $$('#cardsRoot [data-study-cat]').forEach(b => b.onclick = () => {
      const ids = (groups[b.dataset.studyCat] || []).map(d => d.id);
      openStudy(ids);
    });
    if ($('#ckStudyAll')) $('#ckStudyAll').onclick = () => openStudy(decks.filter(d => dueCount(d._deck) > 0).map(d => d.id));
    $('#ckNew').onclick = () => openEditor(null);
    $('#ckImport').onclick = () => importFile();
    $('#ckToggleSeed').onclick = () => $('#ckSeedBox').classList.toggle('hidden');
    renderSeedBox();
  }

  function deckRow(d) {
    const dk = d._deck;
    const n = dk.cards.length;
    const due = dueCount(dk), m = masterCount(dk);
    const pct = n ? Math.round(m / n * 100) : 0;
    return `<div class="ck-deck" data-deck="${d.id}">
      <div class="ck-deck-main">
        <div class="ck-deck-name">${esc(d.title || '未命名')}
          <span class="tag b">${esc(modName(d.module))}</span>
          ${dk.seedId ? '' : '<span class="tag g">自建</span>'}
        </div>
        <div class="ck-deck-sub">${n} 张 · 待复习 ${due} · 已掌握 ${m}（${pct}%）${dk.desc ? ' · ' + esc(dk.desc.slice(0, 40)) : ''}</div>
        <div class="ck-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="ck-deck-act">
        <button class="btn soft sm" data-act="study">${due ? '复习 ' + due : (n && m === n ? '已全部掌握' : '过一遍')}</button>
        <button class="btn ghost sm" data-act="edit">编辑</button>
        <button class="btn ghost sm" data-act="del">删除</button>
      </div>
    </div>`;
  }

  function renderSeedBox() {
    const box = $('#ckSeedBox');
    if (!box) return;
    const seed = window.CY_CARD_SEED || [];
    if (!seed.length) {
      box.innerHTML = '<div class="empty">没找到预置卡片库。<br>如果你的目录里没有 <code>assets/cards.js</code>，跑一下 <code>_extract_cards.py</code> 就能生成。</div>';
      return;
    }
    const loadedIds = new Set(decks.map(d => d._deck.seedId).filter(Boolean));
    const groups = {};
    seed.forEach(s => { (groups[s.cat] = groups[s.cat] || []).push(s); });

    box.innerHTML = Object.keys(groups).map(cat => `
      <div class="ck-seed-group">
        <div class="ck-group-head">
          <span class="ck-group-name">${esc(cat)}</span>
          <span class="hint">${groups[cat].length} 组 · ${groups[cat].reduce((n, s) => n + s.cards.length, 0)} 张</span>
          <span class="spacer"></span>
          <button class="btn soft sm" data-load-cat="${esc(cat)}">载入这一类</button>
        </div>
        <div class="row wrap" style="gap:8px">
          ${groups[cat].map(s => `<button class="btn ${loadedIds.has(s.id) ? 'ghost' : 'ghost'} sm ck-seed-btn" data-load="${s.id}">
            ${esc(s.name.replace(/^[^·]*·\s*/, ''))} · ${s.cards.length} 张${loadedIds.has(s.id) ? ' ✓ 已载入' : ''}
          </button>`).join('')}
        </div>
      </div>`).join('');

    $$('#ckSeedBox [data-load]').forEach(b => b.onclick = () => loadSeed([b.dataset.load]));
    $$('#ckSeedBox [data-load-cat]').forEach(b => b.onclick = async () => {
      const ids = (groups[b.dataset.loadCat] || []).filter(s => !loadedIds.has(s.id)).map(s => s.id);
      if (!ids.length) return toast('这一类已经全部载入过了');
      await loadSeed(ids);
    });
  }

  async function loadSeed(seedIds) {
    const seed = window.CY_CARD_SEED || [];
    const picked = seed.filter(s => seedIds.includes(s.id));
    if (!picked.length) return;
    /**
     * 注意：用 confirm 而不是直接载入，防手滑把所有内容一次灌进存储
     */
    const total = picked.reduce((n, s) => n + s.cards.length, 0);
    if (!confirm(`要载入 ${picked.length} 组、共 ${total} 张卡片吗？\n载入后就是你自己的卡片组，可以随便改或删。`)) return;

    const u = Store.user();
    toast('正在载入……');
    for (const s of picked) {
      const item = {
        userId: u.id, authorName: '系统预置', module: s.module || 'zyk', kind: 'deck',
        title: s.name, visibility: 'private',
        _deck: {
          cat: s.cat, desc: s.desc, seedId: s.id,
          cards: s.cards.map(c => ({ id: uid(), f: c.f, b: c.b, tag: c.tag || '', box: 0, due: today(), seen: 0, right: 0, wrong: 0 }))
        }
      };
      try { await persist(item); }
      catch (e) { toast('载入失败：' + (e.message || e)); break; }
    }
    toast(`已载入 ${picked.length} 组卡片`);
    render();
  }

  /* ---------------- 复习 ---------------- */
  function ensureStudyDom() {
    if ($('#ckStudy')) return;
    const el = document.createElement('div');
    el.id = 'ckStudy';
    el.className = 'overlay hidden';
    el.innerHTML = `
      <div class="panel ck-panel">
        <div class="panel-head">
          <div class="ck-progress"><div class="ck-progress-bar"><i id="ckPbar"></i></div><span class="hint" id="ckPtext">0 / 0</span></div>
          <span class="spacer"></span>
          <button class="btn ghost sm" id="ckExit">结束</button>
        </div>
        <div class="panel-body">
          <div class="ck-tagline" id="ckTag"></div>
          <div class="ck-card">
            <div class="ck-face" id="ckFront"></div>
            <div class="ck-divider hidden" id="ckDiv"></div>
            <div class="ck-face ck-back hidden" id="ckBack"></div>
          </div>
          <div class="ck-actions">
            <button class="btn block" id="ckShow">想好了，看答案</button>
            <div class="ck-rate hidden" id="ckRate">
              <button class="btn danger" data-rate="again">忘了<small>马上再来</small></button>
              <button class="btn ghost" data-rate="hard">模糊<small>明天再看</small></button>
              <button class="btn" data-rate="good">记得<small>往后推</small></button>
            </div>
          </div>
          <div class="hint ck-kbd">快捷键：空格＝看答案　1＝忘了　2＝模糊　3＝记得</div>
        </div>
      </div>`;
    document.body.appendChild(el);
    $('#ckExit').onclick = () => endSession(false);
    $('#ckShow').onclick = () => flipCard(true);
    $$('#ckRate [data-rate]').forEach(b => b.onclick = () => rate(b.dataset.rate));
    document.addEventListener('keydown', e => {
      if (!session) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!session.flipped) flipCard(true); }
      if (session.flipped) {
        if (e.key === '1') rate('again');
        if (e.key === '2') rate('hard');
        if (e.key === '3') rate('good');
      }
      if (e.key === 'Escape') endSession(false);
    });
  }

  async function openStudy(deckIds) {
    deckIds = (deckIds || []).filter(Boolean);
    if (!deckIds.length) return toast('先选一个卡片组');
    await load();
    const items = [];
    deckIds.forEach(id => {
      const d = decks.find(x => x.id === id);
      if (!d) return;
      d._deck.cards.forEach(c => items.push({ deck: d, c }));
    });
    if (!items.length) return toast('这些卡片组里还没有卡片');

    /* 优先复习到期和没见过的；全都熟了也允许手动过一遍 */
    let queue = items.filter(x => isDue(x.c));
    if (!queue.length) queue = items.slice();
    queue.sort((a, b) => (a.c.due || '').localeCompare(b.c.due || ''));

    session = {
      items: queue, idx: 0, flipped: false,
      right: 0, hard: 0, wrong: 0, rounds: {}, touched: {}, total0: queue.length
    };
    ensureStudyDom();
    $('#ckStudy').classList.remove('hidden');
    paintCard();
  }

  function paintCard() {
    if (!session) return;
    if (session.idx >= session.items.length) return finishSession();
    const x = session.items[session.idx];
    const S = session;
    $('#ckTag').innerHTML = `<span class="tag ${x.c.tag ? 'b' : 'g'}">${esc(x.c.tag || x.deck._deck.cat)}</span>
      <span class="hint">${esc(x.deck.title)}</span>`;
    $('#ckFront').textContent = x.c.f || '（这张卡正面是空的）';
    $('#ckBack').textContent = x.c.b || '（没写背面）';
    $('#ckBack').classList.add('hidden');
    $('#ckDiv').classList.add('hidden');
    $('#ckShow').classList.remove('hidden');
    $('#ckRate').classList.add('hidden');
    session.flipped = false;
    const done = session.idx, all = session.items.length;
    $('#ckPtext').textContent = done + ' / ' + all;
    $('#ckPbar').style.width = (all ? Math.round(done / all * 100) : 0) + '%';
  }

  function flipCard() {
    if (!session || session.flipped) return;
    session.flipped = true;
    $('#ckBack').classList.remove('hidden');
    $('#ckDiv').classList.remove('hidden');
    $('#ckShow').classList.add('hidden');
    $('#ckRate').classList.remove('hidden');
  }

  function rate(kind) {
    if (!session || !session.flipped) return;
    const x = session.items[session.idx];
    const c = x.c;
    c.seen = (c.seen || 0) + 1;
    c.last = today();
    session.touched[x.deck.id] = true;

    if (kind === 'again') {
      c.box = 0; c.wrong = (c.wrong || 0) + 1; c.due = today();
      session.wrong++;
      /* 本轮内再出现一次，但最多重复两轮，不然会没完没了 */
      const k = x.deck.id + ':' + c.id;
      session.rounds[k] = (session.rounds[k] || 0) + 1;
      if (session.rounds[k] <= 2) session.items.push(x);
    } else if (kind === 'hard') {
      c.box = Math.max(0, (c.box || 0) - 1);
      c.hard = (c.hard || 0) + 1;
      c.due = addDays(1);          // 按按钮上写的：明天再看，本轮不再出现
      session.hard++;
    } else {
      c.box = Math.min(BOX_DAYS.length - 1, (c.box || 0) + 1);
      c.right = (c.right || 0) + 1;
      c.due = addDays(BOX_DAYS[c.box]);
      session.right++;
    }
    session.idx++;
    paintCard();
  }

  async function finishSession() {
    const s = session;
    const rated = s.right + s.hard + s.wrong;
    const acc = rated ? Math.round(s.right / rated * 100) : 0;
    const key = 'cy_card_' + today();
    let gain = 0;
    if (acc >= 80 && rated >= 5 && !localStorage.getItem(key)) {
      gain = (SEED.POINTS_RULE && SEED.POINTS_RULE.cardRound) || 3;
      localStorage.setItem(key, '1');
      try { await Store.addPoints(gain); } catch (e) { }
    }
    await flushSession();
    session = null;
    $('#ckStudy').classList.add('hidden');
    const box = $('#cardsRoot');
    render().then(() => {
      if (box) box.insertAdjacentHTML('afterbegin', `
        <div class="card ck-result">
          <div class="card-title">这一轮走完了</div>
          <div class="row wrap" style="gap:22px;margin:10px 0">
            <div><div class="ck-stat-n">${rated}</div><div class="ck-stat-l">本轮评价</div></div>
            <div><div class="ck-stat-n brand">${s.right}</div><div class="ck-stat-l">记得</div></div>
            <div><div class="ck-stat-n">${s.hard}</div><div class="ck-stat-l">模糊</div></div>
            <div><div class="ck-stat-n red">${s.wrong}</div><div class="ck-stat-l">忘了</div></div>
            <div><div class="ck-stat-n">${acc}%</div><div class="ck-stat-l">记得率</div></div>
          </div>
          <div class="hint">${acc >= 80 ? '这组掌握得不错。' : '记得率不到 80%，建议明天再来一轮。'}${gain ? ' 本轮 +' + gain + ' 积分。' : ''}</div>
        </div>`);
    });
  }

  async function flushSession() {
    if (!session) return;
    for (const id of Object.keys(session.touched)) {
      const d = decks.find(x => x.id === id);
      if (!d) continue;
      try { await persist(d); } catch (e) { toast('保存卡片进度失败：' + (e.message || e)); }
    }
  }

  async function endSession() {
    if (!session) return;
    const s = session;
    await flushSession();
    session = null;
    $('#ckStudy').classList.add('hidden');
    toast(`已保存进度（记得 ${s.right} / 模糊 ${s.hard} / 忘了 ${s.wrong}）`);
    render();
  }

  /* ---------------- 编辑卡片组 ---------------- */
  function ensureEditorDom() {
    if ($('#ckEditor')) return;
    const el = document.createElement('div');
    el.id = 'ckEditor';
    el.className = 'overlay hidden';
    el.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="card-title" id="ckEdTitle">卡片组</div>
          <span class="spacer"></span>
          <button class="btn ghost sm" id="ckEdClose">关闭</button>
        </div>
        <div class="panel-body">
          <div class="field"><label>卡片组名称</label>
            <input class="input" id="ckEdName" placeholder="例如：申论规范词 · 第一期"></div>
          <div class="grid g3">
            <div class="field"><label>模块</label><select class="input" id="ckEdModule"></select></div>
            <div class="field"><label>分类</label><input class="input" id="ckEdCat" list="ckCatList" placeholder="自定义">
              <datalist id="ckCatList">${CATS.map(c => `<option value="${c}">`).join('')}</datalist></div>
            <div class="field"><label>可见性</label><select class="input" id="ckEdVis">
              <option value="private">仅自己可见</option>
              <option value="public">发布到瀑布流</option></select></div>
          </div>
          <div class="field"><label>说明（可留空）</label>
            <input class="input" id="ckEdDesc" placeholder="这组卡片是练什么的"></div>
          <div class="field">
            <label>卡片内容 · 一行一张，用「——」或「|」分开正面和背面</label>
            <textarea class="input" id="ckEdText" style="min-height:300px" placeholder="修复窑洞要尽量保留自然地貌——保留原貌，修旧如旧
水光潋滟晴方好，______——山色空蒙雨亦奇。"></textarea>
            <div class="hint" style="margin-top:6px">改完点保存即可。每行的 <b>第一个</b> 分隔符左边是正面、右边是背面。<span id="ckEdCount"></span></div>
          </div>
          <div class="row wrap">
            <button class="btn ghost sm" id="ckEdUpload">上传 txt / csv 覆盖内容</button>
            <span class="hint">上传的文本同样按"一行一张"解析</span>
          </div>
          <input type="file" id="ckEdFile" accept=".txt,.csv,.md,text/plain" class="hidden">
        </div>
        <div class="panel-foot">
          <button class="btn" id="ckEdSave">保存</button>
          <span class="hint" id="ckEdMsg"></span>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  /* 支持的分隔符：—— ｜ | :: Tab 全角空格。故意不含英文逗号，
     因为课件正文里逗号太常见，会把一张卡从中间劈开 */
  const SPLIT_RE = /——|--|\||｜|::|\t|　　/;

  function parseLines(text) {
    const out = [];
    String(text || '').split('\n').forEach(line => {
      const s = line.replace(/\r/g, '').trim();
      if (!s || /^\s*#/.test(s)) return;
      const m = s.match(SPLIT_RE);
      if (m) {
        const i = s.indexOf(m[0]);
        const f = s.slice(0, i).trim();
        const b = s.slice(i + m[0].length).trim();
        if (f || b) out.push({ f, b });
      } else {
        out.push({ f: s, b: '' });
      }
    });
    return out;
  }

  function openEditor(deckId) {
    ensureEditorDom();
    const item = deckId ? decks.find(x => x.id === deckId) : null;
    const sel = $('#ckEdModule');
    sel.innerHTML = (SEED.MODULES || []).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    if (item) {
      const d = item._deck;
      $('#ckEdTitle').textContent = '编辑卡片组';
      $('#ckEdName').value = item.title || '';
      $('#ckEdCat').value = d.cat || '自定义';
      $('#ckEdDesc').value = d.desc || '';
      $('#ckEdVis').value = item.visibility || 'private';
      sel.value = item.module || (SEED.MODULES[0] || {}).id;
      $('#ckEdText').value = d.cards.map(c => c.f + ' —— ' + c.b).join('\n');
    } else {
      $('#ckEdTitle').textContent = '新建卡片组';
      $('#ckEdName').value = '';
      $('#ckEdCat').value = '自定义';
      $('#ckEdDesc').value = '';
      $('#ckEdVis').value = 'private';
      sel.value = 'zyk';
      $('#ckEdText').value = '';
    }
    editing = { item };
    const count = () => { $('#ckEdCount').textContent = '现在有 ' + parseLines($('#ckEdText').value).length + ' 张'; };
    $('#ckEdText').oninput = count;
    count();
    $('#ckEdMsg').textContent = '';

    $('#ckEdClose').onclick = () => { editing = null; $('#ckEditor').classList.add('hidden'); };
    $('#ckEdUpload').onclick = () => $('#ckEdFile').click();
    $('#ckEdFile').onchange = e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const txt = String(r.result || '').replace(/\r/g, '');
        if (!confirm('上传的文本会覆盖现在文本框里的内容，继续吗？')) return;
        $('#ckEdText').value = txt.trim();
        count();
        $('#ckEdMsg').textContent = '已读入 ' + f.name;
      };
      r.onerror = () => { $('#ckEdMsg').textContent = '文件读不出来'; };
      r.readAsText(f, 'utf-8');
    };
    $('#ckEdSave').onclick = saveDeck;
    $('#ckEditor').classList.remove('hidden');
  }

  async function saveDeck() {
    const name = $('#ckEdName').value.trim();
    if (!name) return toast('先给卡片组起个名字');
    const rows = parseLines($('#ckEdText').value);
    if (!rows.length) return toast('至少得有一张卡');
    const u = Store.user();
    const item = editing && editing.item
      ? editing.item
      : { userId: u.id, authorName: u.nickname || u.username, module: $('#ckEdModule').value, kind: 'deck', visibility: 'private', _deck: { cards: [] } };

    const old = item._deck || { cards: [] };
    const byKey = {};
    (old.cards || []).forEach(c => { byKey[(c.f || '') + '\u0001' + (c.b || '')] = c; });

    const cards = rows.map(r => {
      const hit = byKey[r.f + '\u0001' + r.b];
      if (hit) return Object.assign({}, hit, { f: r.f, b: r.b });   // 保留原有的复习进度
      return { id: uid(), f: r.f, b: r.b, tag: '', box: 0, due: today(), seen: 0, right: 0, wrong: 0 };
    });

    item.title = name;
    item.module = $('#ckEdModule').value;
    item.visibility = $('#ckEdVis').value;
    item._deck = {
      cat: $('#ckEdCat').value.trim() || '自定义',
      desc: $('#ckEdDesc').value.trim(),
      seedId: old.seedId || '',
      cards
    };
    const kept = cards.filter(c => byKey[c.f + '\u0001' + c.b]).length;
    try {
      await persist(item);
    } catch (e) {
      $('#ckEdMsg').textContent = '保存失败：' + (e.message || e);
      return;
    }
    editing = null;
    $('#ckEditor').classList.add('hidden');
    toast(`已保存，共 ${cards.length} 张` + (kept && kept !== cards.length ? `（${kept} 张的复习进度保留了下来）` : ''));
    render();
  }

  /* ---------------- 上传内容（快速建组） ---------------- */
  function importFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.txt,.csv,.md,text/plain';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        const rows = parseLines(String(r.result || ''));
        if (!rows.length) return toast('这个文件里没解析出卡片');
        const u = Store.user();
        const item = {
          userId: u.id, authorName: u.nickname || u.username, module: 'zyk', kind: 'deck',
          title: f.name.replace(/\.[^.]+$/, ''),
          visibility: 'private',
          _deck: {
            cat: '自定义', desc: '从「' + f.name + '」导入',
            cards: rows.map(x => ({ id: uid(), f: x.f, b: x.b, tag: '', box: 0, due: today(), seen: 0, right: 0, wrong: 0 }))
          }
        };
        try { await persist(item); } catch (e) { return toast('导入失败：' + (e.message || e)); }
        toast(`已导入 ${rows.length} 张卡片`);
        render();
      };
      r.readAsText(f, 'utf-8');
    };
    inp.click();
  }

  window.CY_CARDS = { init: () => { }, render, openStudy, openEditor, parseLines };
})();
