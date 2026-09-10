// 临时自检：在 Node 里跑一遍本机模式的核心逻辑
import fs from 'node:fs';
import vm from 'node:vm';

const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.window = { crypto: globalThis.crypto };
globalThis.TextEncoder = TextEncoder;

const base = 'F:/学习资料/01 花生系统班（主课）/船员学习室/assets/';
vm.runInThisContext(fs.readFileSync(base + 'config.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(base + 'seed.js', 'utf8'));
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

  console.log('\n全部通过。');
})().catch(e => { console.error('❌ 失败：', e); process.exit(1); });
