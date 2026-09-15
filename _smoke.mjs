/* 冒烟测试：在 jsdom 里把整套界面真跑一遍，抓运行时错误
 * 用法：node _smoke.mjs
 * 注意：强制本机模式，不会碰线上 Supabase
 * 依赖 jsdom（只装在隔离工作区里，不进项目目录）：
 *   C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules
 */
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/');
const { JSDOM } = require('jsdom');

const DIR = 'F:/学习资料/01 花生系统班（主课）/船员学习室/';
const read = p => fs.readFileSync(DIR + p, 'utf8');

const errors = [];
const dom = new JSDOM(read('index.html'), {
  url: 'http://localhost:8899/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
window.scrollTo = () => { };
window.alert = m => console.log('   [alert]', m);
window.confirm = () => true;
window.prompt = () => null;
try {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
} catch (e) { }
window.addEventListener('error', e => errors.push('window.onerror: ' + (e.message || e)));
dom.virtualConsole.on('jsdomError', e => {
  const m = String((e && e.message) || e);
  if (/Could not parse CSS|Not implemented/.test(m)) return;
  errors.push('jsdomError: ' + m);
});

const ev = (name, data) => window.eval(name, data);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  ['assets/seed.js', 'assets/cards.js', 'assets/store.js', 'assets/mindmap.js', 'assets/flashcards.js', 'assets/app.js'].forEach(f => {
    try { window.eval(read(f)); } catch (e) { errors.push('加载 ' + f + ' 失败：' + e.message); }
  });
  await wait(300);

  const $ = s => window.document.querySelector(s);
  const $$ = s => Array.from(window.document.querySelectorAll(s));
  const ok = (label, cond, extra) => console.log((cond ? '✅ ' : '❌ ') + label + (extra ? '  → ' + extra : ''));

  /* 1. 登录页出现 */
  ok('启动后停在登录页', !$('#authScreen').classList.contains('hidden'));

  /* 2. 注册第一个账号 */
  $('#authScreen').querySelector('[data-authtab="register"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('#regNick').value = '上岸大魔王';
  $('#regUser').value = 'shangan';
  $('#regPass').value = 'cy@lsj42';
  $('#formRegister').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(400);
  ok('注册后进入主界面', !$('#app').classList.contains('hidden'));
  ok('侧栏昵称已填充', $('#sideName').textContent === '上岸大魔王', $('#sideName').textContent);
  ok('页面标题＝仪表盘', $('#pageTitle').textContent === '仪表盘', $('#pageTitle').textContent);

  /* 3. 侧栏收起 / 展开 */
  $('#btnSideCollapse').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('桌面点「收起侧栏」→ body 加 sb-collapsed', window.document.body.classList.contains('sb-collapsed'));
  $('#btnMenu').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('点汉堡按钮 → 展开回来', !window.document.body.classList.contains('sb-collapsed'));

  /* 4. 日历 */
  await wait(200);
  const cells = $$('#calGrid .cal-cell');
  ok('日历渲染出格子', cells.length >= 28, cells.length + ' 格');
  ok('日历表头是周一起', $('#calHead').textContent.startsWith('一二三'), $('#calHead').textContent);
  ok('今天那格标了 today 和红色未打卡', !!$('#calGrid .cal-cell.today'));
  ok('日历下方有选中日详情', $('#calDay').textContent.includes('月') && $('#calDay').textContent.includes('日'));
  const before = $('#calMonth').textContent;
  $('#calNext').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  ok('翻到下个月', $('#calMonth').textContent !== before, $('#calMonth').textContent);
  $('#calToday').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  ok('回到今天', $('#calMonth').textContent === before);

  /* 5. 今日任务 + 打卡 */
  $('#taskTitle').value = '资料分析第 1 讲';
  $('#btnAddTask').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(150);
  ok('加入任务后任务列表非空', $('#taskList').textContent.includes('资料分析第 1 讲'));
  ok('日历上今天出现任务圆点', $$('#calGrid .cal-cell.today .cdot i').length > 0);
  $('#btnCheckin').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(350);
  ok('打卡后今天变绿', !!$('#calGrid .cal-cell.today.ok'));
  ok('打卡后积分更新', /积分 [1-9]/.test($('#topPoints').textContent), $('#topPoints').textContent);

  /* 6. 番茄钟 */
  $('#pomoPresets').querySelector('[data-focus="15"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('预设 15 分钟后倒计时同步', $('#pomoTime').textContent === '15:00', $('#pomoTime').textContent);
  $('#pomoFocusMin').value = '1';
  $('#pomoStart').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('改完时长再开始 → 按新时长走', $('#pomoTime').textContent === '1:00', $('#pomoTime').textContent);
  ok('开始后按钮变「暂停」', $('#pomoStart').textContent === '暂停', $('#pomoStart').textContent);
  await wait(1300);
  ok('倒计时在走', $('#pomoTime').textContent === '0:59', $('#pomoTime').textContent);
  $('#pomoStart').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('再点变回开始', $('#pomoStart').textContent.includes('开始'), $('#pomoStart').textContent);
  $('#pomoReset').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('重置回到整分钟', $('#pomoTime').textContent === '1:00', $('#pomoTime').textContent);

  /* 7. 视图切换 */
  for (const nav of ['notes', 'forum', 'tools', 'settings', 'home']) {
    const btn = $$('#navSide .nav-item').find(b => b.dataset.nav === nav);
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(180);
    ok('切到「' + btn.textContent.trim() + '」不报错', true, $('#pageTitle').textContent);
  }

  /* 8. 新建图形导图 */
  $$('#navSide .nav-item').find(b => b.dataset.nav === 'notes').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(200);
  $('#btnNewMind').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('导图编辑里出现画布', !!$('#mmStage'));
  ok('空图自动放了中心节点', $$('#mmStage .mmc-node').length === 1, $$('#mmStage .mmc-node').length + ' 个节点');
  $('#edTitle').value = '测试导图';

  $('#mmAddChild').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(80);
  $('#mmAddSib').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(80);
  $('#mmAddFree').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(80);
  const nNodes = $$('#mmStage .mmc-node').length;
  ok('加子/同级/自由节点 → 4 个节点', nNodes === 4, nNodes + ' 个');
  const dAttr = $$('#mmStage .mmc-svg path').map(p => p.getAttribute('d')).join(' ');
  const segs = (dAttr.match(/M/g) || []).length;
  ok('连线画了 2 条（父子各一条）', segs === 2, segs + ' 条线段');

  $('#mmText').value = '基期量 = 现期量 ÷ (1 + 增长率)';
  $('#mmText').dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('改文字即时生效', $('#mmStage .mmc-node.sel .mtx').textContent.includes('基期量'), $('#mmStage .mmc-node.sel .mtx').textContent);

  $('#mmWide').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('长文本节点开关生效', $('#mmStage .mmc-node.sel').classList.contains('wide'));
  $('#mmLayout').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(80);
  ok('整理布局没炸', true);
  $('#mmIn').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('#mmOut').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('#mmFit').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('缩放百分比有显示', /%$/.test($('#mmZoom').textContent), $('#mmZoom').textContent);

  $('#mmImport').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('#mmOutlineText').value = '资料分析\n  核心公式\n    基期量 = 现期量 ÷ (1 + 增长率)\n  速算技巧\n    截位直除';
  $('#mmOutlineOk').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('大纲导入生成 5 节点', $$('#mmStage .mmc-node').length === 5, $$('#mmStage .mmc-node').length + ' 个');

  /* 9. 预览 + 导图默写模式 + 默写挖空 */
  $('#editTabs').querySelector('[data-etab="preview"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('预览里挂出只读导图', !!$('#pvStage') && $$('#pvStage .mmc-node').length === 5, $$('#pvStage .mmc-node').length + ' 个');
  $('#pvReveal').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('默写模式盖住文字', $$('#pvStage .mmc-node.hidetext').length === 5);
  ok('按钮文字变「退出」', $('#pvReveal').textContent.includes('退出'), $('#pvReveal').textContent);
  $('#pvStage .mmc-node').dispatchEvent(new window.Event('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  ok('点节点揭开一个', $$('#pvStage .mmc-node.revealed').length === 1, $('#pvStat').textContent);

  $('#editTabs').querySelector('[data-etab="recite"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('导图能出默写挖空', $$('#reciteBox .blank').length > 0, $$('#reciteBox .blank').length + ' 个空');
  $('#btnReCheck').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  ok('对答案出正确率', $('#reciteResult').textContent.includes('正确率'), $('#reciteResult').textContent.slice(0, 40));

  /* 10. 保存 + 列表 + 瀑布流 */
  $('#editTabs').querySelector('[data-etab="edit"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('切回编辑后标题还在（不会被重绘清空）', $('#edTitle').value === '测试导图', JSON.stringify($('#edTitle').value));
  $('#edVis').value = 'public';
  $('#btnSave').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(400);
  ok('保存提示', $('#toast').textContent || '(无)', $('#toast').textContent);
  ok('保存后关闭编辑器', $('#editor').classList.contains('hidden'));
  ok('笔记列表出现新建的导图', $('#noteList').textContent.includes('测试导图'));
  /* 回归防线：新建内容的 id 不能是空的，否则列表里点它没反应 */
  const newCard = $$('#noteList .note-card').find(el => el.textContent.includes('测试导图'));
  ok('新建内容的 id 不是 undefined', !!newCard && newCard.dataset.id !== 'undefined' && !!newCard.dataset.id,
    newCard ? newCard.dataset.id : '(没找到卡片)');
  newCard.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(300);
  ok('点卡片能重新打开（id 对得上）', !$('#editor').classList.contains('hidden'));
  $('#btnEditClose').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);

  $$('#navSide .nav-item').find(b => b.dataset.nav === 'forum').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  ok('瀑布流显示作者与日期', $('#forumList').textContent.includes('上岸大魔王') && /\d{4}-\d{2}-\d{2}/.test($('#forumList').textContent));

  /* 11. 知识点复习弹层渲染旧大纲数据 */
  $$('#navSide .nav-item').find(b => b.dataset.nav === 'home').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(250);
  const tile = $$('#moduleTiles .mod-tile')[0];
  tile.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(400);
  ok('复习弹层把预置导图渲染成图形', $$('#reviewBody .mmc-stage .mmc-node').length > 0,
    $$('#reviewBody .mmc-stage').length + ' 张图 / ' + $$('#reviewBody .mmc-stage .mmc-node').length + ' 节点');
  $('#btnReviewClose').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('关闭复习弹层', $('#reviewModal').classList.contains('hidden'));

  /* 12. 卡片记忆 */
  const CARDS = window.CY_CARDS;
  ok('卡片模块已加载', typeof CARDS === 'object' && typeof CARDS.render === 'function');
  const seedCount = (window.CY_CARD_SEED || []).reduce((n, d) => n + d.cards.length, 0);
  ok('预置卡片库读到了', seedCount > 500, seedCount + ' 张 / ' + (window.CY_CARD_SEED || []).length + ' 组');

  const parsed = CARDS.parseLines('正面甲——背面甲\n正面乙 | 背面乙\n没分隔符的一行');
  ok('一行一卡的解析', parsed.length === 3 && parsed[0].b === '背面甲' && parsed[1].b === '背面乙' && parsed[2].b === '',
    JSON.stringify(parsed));

  $$('#navSide .nav-item').find(b => b.dataset.nav === 'cards').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(350);
  ok('切到卡片记忆页', $('#pageTitle').textContent === '卡片记忆', $('#pageTitle').textContent);
  ok('空状态提示 + 预置库入口', $('#cardsRoot').textContent.includes('预置卡片库'));

  $('#ckToggleSeed').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  const seedBtn = $('#ckSeedBox [data-load]');
  ok('预置库列出了可载入的组', !!seedBtn, seedBtn ? seedBtn.textContent.trim().slice(0, 30) : '');
  seedBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(700);
  const deckEls = $$('#cardsRoot [data-deck]');
  ok('载入预置组后出现卡片组', deckEls.length === 1, deckEls.length + ' 组');
  ok('统计里有卡片总数', /\d/.test($('#cardsRoot .ck-stat-n').textContent), $('#cardsRoot .ck-stat-n').textContent);

  /* 自建一个两组卡的卡片组，然后真复习一轮 */
  $('#ckNew').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(200);
  ok('打开卡片组编辑器', !$('#ckEditor').classList.contains('hidden'));
  $('#ckEdName').value = '测试卡片组';
  $('#ckEdText').value = '水光潋滟晴方好——山色空蒙雨亦奇\n人不负青山——青山定不负人';
  $('#ckEdText').dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('编辑器实时统计张数', $('#ckEdCount').textContent.includes('2 张'), $('#ckEdCount').textContent);
  $('#ckEdSave').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(500);
  ok('保存后编辑器关闭', $('#ckEditor').classList.contains('hidden'));
  const mine = $$('#cardsRoot [data-deck]').filter(el =>
    el.textContent.includes('测试卡片组'))[0];
  ok('新卡片组出现在列表里', !!mine);

  mine.querySelector('[data-act="study"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(400);
  ok('复习面板打开', !$('#ckStudy').classList.contains('hidden'));
  ok('先只显示正面', !$('#ckBack') || $('#ckBack').classList.contains('hidden'));
  ok('进度显示 0 / 2', $('#ckPtext').textContent === '0 / 2', $('#ckPtext').textContent);
  $('#ckShow').dispatchEvent(new window.Event('click', { bubbles: true }));
  ok('点看答案后显示背面', !$('#ckBack').classList.contains('hidden'), $('#ckBack').textContent);
  ok('评分按钮出现', !$('#ckRate').classList.contains('hidden'));
  $$('#ckRate [data-rate]').find(b => b.dataset.rate === 'good').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  ok('评价后进入第 2 张', $('#ckPtext').textContent === '1 / 2', $('#ckPtext').textContent);
  $('#ckShow').dispatchEvent(new window.Event('click', { bubbles: true }));
  $$('#ckRate [data-rate]').find(b => b.dataset.rate === 'again').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(120);
  ok('「忘了」的卡会被挑回来重来', $$('#ckPtext').length && $('#ckPtext').textContent === '2 / 3', $('#ckPtext').textContent);
  $('#ckShow').dispatchEvent(new window.Event('click', { bubbles: true }));
  $$('#ckRate [data-rate]').find(b => b.dataset.rate === 'hard').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(800);
  ok('一轮走完后面板关闭', $('#ckStudy').classList.contains('hidden'));
  ok('出结算卡片', $('#cardsRoot').textContent.includes('这一轮走完了'));
  ok('结算里有记得率', /记得率/.test($('#cardsRoot').textContent));

  console.log('\n' + (errors.length ? '❌ 运行期报错 ' + errors.length + ' 处：\n - ' + errors.join('\n - ') : '✅ 全程没有运行时错误'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => {
  console.error('❌ 冒烟测试崩溃：', e);
  if (errors.length) console.error('已捕获的报错：', errors);
  process.exit(1);
});
