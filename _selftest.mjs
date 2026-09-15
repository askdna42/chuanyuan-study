// 临时自检：在 Node 里跑一遍本机模式的核心逻辑
import fs from 'node:fs';
import vm from 'node:vm';

const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.window = { crypto: globalThis.crypto, CY_CONFIG: { syncMode: 'local' } };
globalThis.TextEncoder = TextEncoder;

const base = 'F:/学习资料/01 花生系统班（主课）/船员学习室/assets/';
/* 故意不加载 config.js：自检永远跑本机模式，绝不去碰线上的 Supabase */
vm.runInThisContext(fs.readFileSync(base + 'seed.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(base + 'mindmap.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(base + 'store.js', 'utf8'));

const { Store } = globalThis.window.CY;
const log = (...a) => console.log('  ', ...a);

(async () => {
  await Store.init();
  console.log('1) 初始状态：', Store.mode, '用户 =', Store.user());

  const admin = await Store.signUp({ username: 'shangan', nickname: '上岸大魔王', password: 'cy@lsj42' });
  console.log('2) 第一个注册 → 身份：', admin.role, '| 昵称：', admin.nickname);
  if (admin.role !== 'admin') throw new Error('第一个人应该是管理员');

  let tasks = await Store.listTasks(new Date().toISOString().slice(0, 10));
  console.log('3) 今日任务初始：', tasks.length);

  await Store.addTask({ date: new Date().toISOString().slice(0, 10), module: 'zlfx', title: '资料分析第 1 讲' });
  await Store.addTask({ date: new Date().toISOString().slice(0, 10), module: 'yyjj', title: '言语 1000 词 2 组' });
  tasks = await Store.listTasks(new Date().toISOString().slice(0, 10));
  console.log('4) 加入 2 条后：', tasks.length, tasks.map(t => t.title).join(' / '));

  const c1 = await Store.doCheckin();
  console.log('5) 第一次打卡：', c1.msg, '| 连签', Store.user().streak, '| 积分', Store.user().points);
  const c2 = await Store.doCheckin();
  console.log('6) 重复打卡应被拒绝：', c2.ok, c2.msg);
  if (c2.ok) throw new Error('重复打卡没被拦住');

  tasks = await Store.listTasks(new Date().toISOString().slice(0, 10));
  for (const t of tasks) await Store.toggleTask(t.id, true);
  console.log('7) 任务全部完成');

  const rewards = await Store.listRewards();
  console.log('8) 预置奖励：', rewards.length, '个 →', rewards.map(r => r.title).join('、'));
  const r0 = await Store.redeemReward(rewards[0].id);
  console.log('9) 兑换最便宜的奖励：', r0.msg, '| 剩余积分', Store.user().points);

  const exams = await Store.listExams();
  console.log('10) 考试倒计时：', exams.map(e => e.name + '=' + (e.date || '待定')).join(' | '));
  if (exams.length !== 3) throw new Error('应该有 3 个考试');

  const code = await Store.createInvite();
  console.log('11) 管理员生成邀请码：', code);

  await Store.signOut();
  let blocked = false;
  try { await Store.signUp({ username: 'xiaoming', nickname: '小明', password: '123456' }); }
  catch (e) { blocked = true; console.log('12) 无邀请码注册 →', e.message); }
  if (!blocked) throw new Error('没有邀请码居然注册成功了');

  const mate = await Store.signUp({ username: 'xiaoming', nickname: '小明', password: '123456', invite: code });
  console.log('13) 凭邀请码注册 →', mate.nickname, '|', mate.role);

  const mine = await Store.listItems({ userId: mate.id, kind: 'mindmap' });
  console.log('14) 新账号自动铺好导图：', mine.length, '张 →', mine.slice(0, 3).map(i => i.title).join(' / '));

  await Store.saveItem({ userId: mate.id, authorName: '小明', module: 'zlfx', kind: 'note', title: '速算心得', content: '截位直除真好用', visibility: 'public' });
  const forum = await Store.listItems({ visibility: 'public' });
  console.log('15) 瀑布流可见条数：', forum.length, '| 作者', forum[0].authorName, '| 日期', forum[0].createdAt.slice(0, 10));

  const mateOnly = await Store.listItems({ userId: mate.id, kind: 'mindmap' });
  const adminOnly = await Store.listItems({ userId: admin.id, kind: 'mindmap' });
  console.log('16) 各自导图数：管理员', adminOnly.length, '/ 小明', mateOnly.length);
  if (mateOnly.length === 0) throw new Error('新用户没有预置导图');

  const like = await Store.toggleLike(forum[0].id);
  console.log('17) 点赞后：', like);

  /* ---------- 18+ 日历 / 番茄钟 / 图形导图 ---------- */
  const MIND = globalThis.window.CY_MIND;
  const dstr = n => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  await Store.saveItem({
    userId: admin.id, authorName: '上岸大魔王', module: 'zlfx', kind: 'mindmap',
    title: '图形导图测试',
    content: MIND.serialize(MIND.fromIndentText('资料分析\n  核心公式\n    基期量 = 现期量 ÷ (1 + 增长率)\n  速算技巧\n    截位直除')),
    visibility: 'private'
  });
  const saved = (await Store.listItems({ userId: admin.id, kind: 'mindmap' })).find(i => i.title === '图形导图测试');
  const g = MIND.parse(saved.content);
  const depthOf = n => { let d = 0, cur = n, guard = 0; while (cur.p && guard++ < 20) { cur = g.nodes.find(x => x.id === cur.p) || {}; d++; } return d; };
  console.log('18) 图形导图节点数：', g.nodes.length, '| 最深层级：', Math.max(...g.nodes.map(depthOf)));
  if (g.nodes.length !== 5) throw new Error('缩进文本 → 图形导图，节点数不对（应为 5）');
  if (!g.nodes.some(n => n.p === null)) throw new Error('没有根节点');
  if (Math.max(...g.nodes.map(depthOf)) !== 2) throw new Error('层级没建对');

  const txt = MIND.toOutlineText(g, true);
  console.log('19) 图形导回文本：', JSON.stringify(txt.split('\n')[1]));
  if (!txt.includes('核心公式')) throw new Error('图形 → 文本 丢了内容');

  const legacy = MIND.parse(JSON.stringify({ t: '资料分析', c: [{ t: '核心公式', c: [{ t: '增长率', c: [] }] }] }));
  console.log('20) 旧大纲数据自动升级：', legacy.nodes.length, '个节点');
  if (legacy.nodes.length !== 3) throw new Error('旧大纲转图形失败');

  const posKey = n => n.x + ',' + n.y;
  console.log('21) 自动布局有坐标：', g.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)) ? '是' : '否',
    '| 没有两个节点重叠：', new Set(g.nodes.map(posKey)).size === g.nodes.length ? '是' : '否');
  if (!g.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))) throw new Error('布局坐标没算出来');
  if (new Set(g.nodes.map(posKey)).size !== g.nodes.length) throw new Error('布局把节点叠在一起了');

  const ex = MIND.excerpt(g, 40);
  console.log('22) 卡片摘要：', ex);

  await Store.addTask({ date: dstr(-2), module: 'zlfx', title: '两天前的任务' });
  await Store.addTask({ date: dstr(0), module: 'yyjj', title: '今天的任务B' });
  const range = await Store.listTasksRange(dstr(-7), dstr(0));
  console.log('23) 日历区间取任务（近 7 天）：', range.length, '条 →', range.map(t => t.date + ' ' + t.title).join(' | '));
  if (range.some(t => t.date > dstr(0) || t.date < dstr(-7))) throw new Error('区间查询越界了');
  if (!range.some(t => t.date === dstr(-2))) throw new Error('区间查询漏了往日任务');

  await Store.signIn({ username: 'shangan', password: 'cy@lsj42' });
  const ckAll = await Store.listCheckins();
  console.log('24) 打卡记录（日历上色的依据）：', ckAll.map(c => c.date).join(', '));
  if (!ckAll.length) throw new Error('打卡记录为空，日历上不了色');

  console.log('25) 番茄钟积分规则：+', globalThis.window.CY_SEED.POINTS_RULE.pomodoro, '分/轮');
  if (!globalThis.window.CY_SEED.POINTS_RULE.pomodoro) throw new Error('番茄钟积分规则没配');

  /* ---------- 26+ 卡片组（kind='deck'，复用 items 表，不用改数据库） ---------- */
  const deck = {
    userId: admin.id, authorName: '上岸大魔王', module: 'sl', kind: 'deck',
    title: '测试卡片组', visibility: 'private',
    content: JSON.stringify({
      cat: '申论规范词', desc: '自检用', seedId: 'test',
      cards: [{ id: 'a', f: '水光潋滟晴方好——', b: '山色空蒙雨亦奇', box: 2, due: '2026-09-20' }]
    })
  };
  const saved2 = await Store.saveItem(deck);
  console.log('26) 卡片组保存：', saved2 && saved2.id ? '成功，id 正常' : '失败', '| id =', typeof saved2 === 'string' ? saved2 : (saved2 && saved2.id));
  const deckList = await Store.listItems({ userId: admin.id, kind: 'deck' });
  if (deckList.length !== 1) throw new Error('卡片组没存进去，或与笔记混在了一起');
  const parsedDeck = JSON.parse(deckList[0].content);
  console.log('27) 卡片组内容可读：', parsedDeck.cat, '/', parsedDeck.cards.length, '张 / 盒号', parsedDeck.cards[0].box);
  if (parsedDeck.cards[0].b !== '山色空蒙雨亦奇') throw new Error('卡片正反面读出来不对');

  const noteOnly = await Store.listItems({ userId: admin.id, kind: 'note' });
  const mapOnly = await Store.listItems({ userId: admin.id, kind: 'mindmap' });
  console.log('28) 卡片组没有污染笔记列表：笔记', noteOnly.length, '条 / 导图', mapOnly.length, '张 / 卡片组', deckList.length, '组');

  /* 新建内容必须拿到真实 id（曾经有过 id 为 undefined、列表点不开的 bug） */
  const fresh = await Store.saveItem({ userId: admin.id, module: 'sl', kind: 'note', title: '临时', content: 'x', id: undefined });
  const freshId = typeof fresh === 'string' ? fresh : (fresh && fresh.id);
  console.log('29) 新建内容拿到 id：', freshId ? '正常（' + String(freshId).slice(0, 8) + '…）' : '异常：id 是空的');
  if (!freshId) throw new Error('新建内容 id 为空，列表里会点不开');

  console.log('\n全部通过。');
})().catch(e => { console.error('❌ 失败：', e); process.exit(1); });
