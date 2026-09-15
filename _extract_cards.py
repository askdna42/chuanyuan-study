# -*- coding: utf-8 -*-
"""船员学习室 · 卡片内容抽取

从 F 盘的四类课件里榨出可背诵的卡片：
  1. 申论规范词积累 1-16 期（答案版）  「材料原文 —— 规范词」→ 概括题卡片
  2. 政治理论背诵清单（王君涛 8 份）  【】标出的就是答案 → 挖空卡片
  3. 申论背诵素材 8 份（环境保护/民生保障/乡村振兴/文化发展/基层治理/经济发展/执法）
     诗句、习语 → 金句补全卡；论证段 → 范文段落卡
  4. 申论常用对策总结 + 各周热点对策 → 场景/做法卡片

用法：
  python _extract_cards.py
输出：
  assets/cards.js   （window.CY_CARD_SEED = [...]，供网页直接加载）
"""
import os
import re
import json
import sys

from pypdf import PdfReader

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(ROOT)                      # F:/学习资料/01 花生系统班（主课）
SL = os.path.join(BASE, '申论系统班')
XC = os.path.join(BASE, '行测系统班')
OUT = os.path.join(ROOT, 'assets', 'cards.js')

HEADER = re.compile(
    r'关注[“"]?(花生十三|飞扬申论课堂)[”"]?公众号'
    r'|^第\s*\d+\s*页$'
    r'|每日素材积累'
    r'|政治理论(基础)?知识?练习?清单'
    r'|^第[一二三四五六七八九十]+篇'
)

# 课件里混着的口语/答疑痕迹，不是知识点，直接丢掉
JUNK = re.compile(
    r'都对|上一节课|大家容易|我们教|不要盲目|拆解好|先判断|会了没|记一下|'
    r'讲一下|请听|是吧|对吧|注意听|哈哈|例：|举例|马政经\+新思想'
)

decks = []
warnings = []


def pdf_text(path, max_pages=None):
    r = PdfReader(path)
    pages = r.pages if max_pages is None else r.pages[:max_pages]
    return '\n'.join((p.extract_text() or '') for p in pages)


def clean_line(s):
    s = s.replace('\u3000', ' ').strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def drop_headers(lines):
    return [l for l in (clean_line(x) for x in lines) if l and not HEADER.search(l)]


def add_deck(did, name, module, cat, desc, cards):
    cards = [c for c in cards if c.get('f') and c.get('b')]
    if not cards:
        warnings.append('空卡片组：' + name)
        return
    decks.append({'id': did, 'name': name, 'module': module, 'cat': cat,
                  'desc': desc, 'cards': cards})


# ---------------------------------------------------------------- 1. 规范词
def build_guifan():
    d = os.path.join(SL, '规范词积累')
    if not os.path.isdir(d):
        warnings.append('找不到规范词目录')
        return
    files = {}
    for fn in sorted(os.listdir(d)):
        m = re.match(r'规范词积累第(.+?)期.*答案版.*\.pdf$', fn)
        if m:
            files[m.group(1)] = os.path.join(d, fn)

    order = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
             '十一', '十二', '十三', '十四', '十五', '十六']
    all_cards = []
    for idx, key in enumerate(order, 1):
        path = files.get(key)
        if not path:
            continue
        text = pdf_text(path)
        lines = drop_headers(text.split('\n'))
        items, cur = [], None
        for line in lines:
            if re.match(r'^规范词', line):
                continue
            m = re.match(r'^(\d{1,3})\s*[.．]\s*(.+)$', line)
            if m:
                if cur:
                    items.append(cur)
                cur = m.group(2)
            elif cur is not None:
                cur += line
        if cur:
            items.append(cur)

        cards = []
        for it in items:
            it = it.strip()
            parts = re.split(r'—{2,}|-{2,}|–{2,}', it, maxsplit=1)
            if len(parts) != 2:
                continue
            front = parts[0].strip()
            back = re.sub(r'^[\s。，、]+', '', parts[1].strip())
            if len(front) < 8 or not (2 <= len(back) <= 40):
                continue
            cards.append({'f': front, 'b': back, 'tag': '第%s期' % key})
        all_cards.append((idx, key, cards))

    # 每 4 期合并成一个卡片组，方便一次练一个阶段
    for start in range(0, len(all_cards), 4):
        chunk = all_cards[start:start + 4]
        keys = [c[1] for c in chunk]
        cards = [x for c in chunk for x in c[2]]
        if not cards:
            continue
        rng = '第%s期' % keys[0] if len(keys) == 1 else '第%s—%s期' % (keys[0], keys[-1])
        add_deck('gf%d' % (start // 4 + 1),
                 '申论规范词 · ' + rng,
                 'sl', '申论规范词',
                 '给一段材料，说出它对应的规范词——这就是申论概括题的核心动作。%d 张' % len(cards),
                 cards)


# ------------------------------------------------------- 2. 政治理论背诵清单
def split_items(text):
    """把正文按行合并成逻辑条目：续行并到上一行"""
    out = []
    for raw in text.split('\n'):
        line = clean_line(raw)
        if not line or HEADER.search(line):
            continue
        starts_new = bool(re.match(r'^[（(]?\d{1,3}[)）.．、]', line))
        if out and not starts_new and not re.search(r'[。！？；：]$', out[-1]):
            out[-1] += line
        else:
            out.append(line)
    return out


def build_zhengzhi():
    d = os.path.join(XC, '政治理论', '王君涛老师', '资料')
    if not os.path.isdir(d):
        warnings.append('找不到政治理论背诵清单目录')
        return
    for fn in sorted(os.listdir(d)):
        if not fn.lower().endswith('.pdf'):
            continue
        path = os.path.join(d, fn)
        try:
            text = pdf_text(path)
        except Exception as e:
            warnings.append('读不了 %s：%s' % (fn, e))
            continue
        name = re.sub(r'^【四海】政治理论(基础)?背诵清单-?', '', fn)
        name = re.sub(r'\.pdf$', '', name, flags=re.I)
        cards = []
        for it in split_items(text):
            if '【' not in it:
                continue
            answers = re.findall(r'【(.+?)】', it)
            if not answers:
                continue
            # 过滤：碎成太多空的、答案过长的，都是解压错位的烂卡，宁缺勿滥
            if len(answers) > 4:
                continue
            back = '、'.join(a.strip() for a in answers if a.strip())
            if not back or len(back) > 60:
                continue
            front = re.sub(r'【(.+?)】', '【　　】', it)
            front = front.lstrip('0123456789.．、)）]】 ')
            if len(front) < 8:
                continue
            if JUNK.search(front) or JUNK.search(back):
                continue
            # 平均每个空至少要有 16 个字垫着，否则就是这张卡被拆碎了
            if front.count('【　　】') * 16 > len(front):
                continue
            if len(front) > 220:
                front = front[:220] + '……'
            cards.append({'f': front, 'b': back, 'tag': name})

        # 兜底：有些清单（如"十五五（上）"）没有用【】标答案，
        # 那就改成"补后半句"式的背诵卡，别让这份内容白白丢掉
        if not cards:
            for it in split_items(text):
                it = re.sub(r'^[（(]?\d{1,3}[)）.．、]\s*', '', it)
                if len(it) < 14 or re.match(r'^[》】]', it):
                    continue
                c = jinju_card(it, name)
                if c:
                    cards.append(c)

        add_deck('zz-' + re.sub(r'[^0-9A-Za-z\u4e00-\u9fa5]', '', name)[:12],
                 '政治理论 · ' + name,
                 'zzll', '政治理论背诵清单',
                 '把答案背出来。有【】的按原清单挖空，没有的按"补后半句"考。%d 张' % len(cards),
                 cards)


# --------------------------------------------------------- 3. 申论背诵素材
def jinju_card(line, tag):
    line = line.strip().strip('“”"')
    if len(line) < 8:
        return None
    if '，' in line:
        i = line.rfind('，')
        front, back = line[:i] + '，______', line[i + 1:]
    elif len(line) >= 12:
        front, back = line[:len(line) // 2] + '……', line
    else:
        return None
    if len(back) < 3 or len(back) > 80:
        return None
    return {'f': front, 'b': back, 'tag': tag}


def build_sucai():
    d = os.path.join(SL, '素材积累')
    if not os.path.isdir(d):
        warnings.append('找不到素材积累目录')
        return
    for fn in sorted(os.listdir(d)):
        if not fn.lower().endswith('.pdf') or '背诵素材' not in fn:
            continue
        m = re.search(r'（(.+?)）', fn)
        theme = m.group(1) if m else re.sub(r'\.pdf$', '', fn)
        try:
            text = pdf_text(os.path.join(d, fn))
        except Exception as e:
            warnings.append('读不了 %s：%s' % (fn, e))
            continue
        lines = drop_headers(text.split('\n'))
        section = ''
        cards = []
        buf = None
        for line in lines:
            if line in ('诗句', '习语', '论证段', '名言警句'):
                section = line
                buf = None
                continue
            if section in ('诗句', '名言警句', '习语'):
                c = jinju_card(line, theme + '·' + section)
                if c:
                    cards.append(c)
            elif section == '论证段':
                if len(line) < 24:            # 小标题（主题词）跳过
                    continue
                if buf is None or len(buf[1]) < 260:
                    pass
                # 段落以句号+换页痕迹为界：够长且以句号结尾就收一张
                if buf and len(buf) > 200:
                    cards.append({'f': '背一段范文（%s）：%s……' % (theme, buf[:14]),
                                  'b': buf, 'tag': theme + '·论证段'})
                    buf = line
                else:
                    buf = (buf + line) if buf else line
        if buf and len(buf) > 120:
            cards.append({'f': '背一段范文（%s）：%s……' % (theme, buf[:14]),
                          'b': buf, 'tag': theme + '·论证段'})
        add_deck('sc-' + re.sub(r'[^0-9A-Za-z\u4e00-\u9fa5]', '', theme)[:10],
                 '申论素材 · ' + theme,
                 'sl', '申论背诵素材',
                 '诗句、习语按"补后半句"考你；论证段整段背，写大作文直接用。%d 张' % len(cards),
                 cards)


# ------------------------------------------------------------- 4. 对策
def build_duice_file(path, did, name, desc, cat='申论对策'):
    lines = drop_headers(pdf_text(path).split('\n'))
    cards, cur, group = [], None, ''
    for line in lines:
        if re.match(r'^序号\s', line):
            continue
        m = re.match(r'^(\d{1,3})\s+(\S{2,12}?)\s+(.+)$', line)
        if m:
            if cur:
                cards.append(cur)
            cur = {'f': '【%s】场景：%s' % (group or cat, m.group(2)),
                   'b': m.group(3).strip(), 'tag': group or cat}
            continue
        if re.match(r'^[\u4e00-\u9fa5/、]{2,16}$', line):
            if cur:
                cards.append(cur)
                cur = None
            group = line
            continue
        if cur:
            cur['b'] += line
    if cur:
        cards.append(cur)
    cards = [c for c in cards if 2 <= len(c['b']) <= 400]
    if cards:
        add_deck(did, name, 'sl', cat, desc + '（%d 张）' % len(cards), cards)


def build_duice():
    d = os.path.join(SL, '素材积累')
    if not os.path.isdir(d):
        return
    p = os.path.join(d, '常用对策总结.pdf')
    if os.path.exists(p):
        build_duice_file(p, 'dc-changyong', '申论对策 · 常用对策总结',
                         '给一个场景，说出具体怎么干。申论提出对策题直接抄活用。')

    hot = []
    for fn in sorted(os.listdir(d)):
        if '热点对策' in fn and fn.lower().endswith('.pdf'):
            try:
                lines = drop_headers(pdf_text(os.path.join(d, fn)).split('\n'))
            except Exception as e:
                warnings.append('读不了 %s：%s' % (fn, e))
                continue
            title = re.sub(r'\.pdf$', '', fn)
            buf = None
            for line in lines:
                if re.match(r'^[（(]?[一二三四五六七八九十\d]{1,3}[)）.．、]', line) or re.match(r'^[\u4e00-\u9fa5]{2,14}$', line):
                    if buf and len(buf['b']) > 60:
                        hot.append(buf)
                    buf = {'f': '【%s】%s' % (title, line[:24]),
                           'b': line + ' ', 'tag': title}
                elif buf:
                    buf['b'] += line
            if buf and len(buf['b']) > 60:
                hot.append(buf)
    if hot:
        add_deck('dc-redian', '申论对策 · 各周热点对策',
                 'sl', '申论对策',
                 '热点话题的现成对策表述，按周整理。（%d 张）' % len(hot), hot)


def main():
    build_guifan()
    build_zhengzhi()
    build_sucai()
    build_duice()

    total = sum(len(d['cards']) for d in decks)
    payload = json.dumps(decks, ensure_ascii=False, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('/* 船员学习室 · 预置卡片组（由 _extract_cards.py 自动生成，不要手改）\n'
                ' * 来源：F 盘课件（申论规范词积累 / 政治理论背诵清单 / 申论背诵素材 / 常用对策总结）\n'
                ' * 共 %d 组 / %d 张卡片\n */\n' % (len(decks), total))
        f.write('window.CY_CARD_SEED = ' + payload + ';\n')

    print('卡片组 %d 个，卡片 %d 张' % (len(decks), total))
    for d in decks:
        print('  %-28s %4d 张  [%s]' % (d['name'], len(d['cards']), d['cat']))
    print('\n每组抽 2 张看看质量：')
    for d in decks:
        print('【%s】' % d['name'])
        for c in d['cards'][:2]:
            print('   正：', c['f'][:70])
            print('   背：', c['b'][:70])
    print('\n输出：%s  (%.1f KB)' % (OUT, os.path.getsize(OUT) / 1024))
    if warnings:
        print('\n注意：')
        for w in warnings:
            print('  -', w)


if __name__ == '__main__':
    sys.exit(main())
