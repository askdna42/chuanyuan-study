/* 船员学习室 · 图形思维导图引擎
 *
 * 数据格式（存进 items.content 的 JSON 字符串）：
 *   { v:1, nodes:[ { id, t:文字, x, y, p:父节点id|null, img:dataURL, wide:布尔 } ] }
 *
 * 旧的「大纲式」导图（{t,c} 树 或 缩进文本）会在打开时自动转成图形，
 * 所以老数据不会丢，只是换了种画法。
 *
 * 对外接口：window.CY_MIND
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const GAP_X = 336;      // 每一级横向间距
  const GAP_Y = 86;       // 同一级纵向间距
  const ORIGIN_X = 48;
  const ORIGIN_Y = 44;
  const ZOOM_MIN = 0.28;
  const ZOOM_MAX = 2.4;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const el = (tag, cls) => { const d = document.createElement(tag); if (cls) d.className = cls; return d; };
  const isBlank = s => !String(s == null ? '' : s).trim();

  /* ---------------- 数据规整 ---------------- */

  function normalize(o) {
    const nodes = [];
    const seen = {};
    (o.nodes || []).forEach(raw => {
      if (!raw) return;
      let id = String(raw.id || rid());
      while (seen[id]) id = rid();
      seen[id] = 1;
      nodes.push({
        id,
        t: raw.t == null ? '' : String(raw.t),
        x: Number.isFinite(raw.x) ? raw.x : 0,
        y: Number.isFinite(raw.y) ? raw.y : 0,
        p: raw.p || null,
        img: raw.img || '',
        wide: !!raw.wide
      });
    });
    nodes.forEach(n => { if (n.p && !nodes.some(m => m.id === n.p)) n.p = null; });
    return { v: 1, nodes };
  }

  function isGraph(content) {
    const s = String(content || '').trim();
    if (!s.startsWith('{')) return false;
    try { const o = JSON.parse(s); return !!(o && Array.isArray(o.nodes)); } catch (e) { return false; }
  }
  function isOutline(content) {
    const s = String(content || '').trim();
    if (!s.startsWith('{')) return false;
    try {
      const o = JSON.parse(s);
      return !!(o && !Array.isArray(o.nodes) && (o.t !== undefined || Array.isArray(o.c)));
    } catch (e) { return false; }
  }

  /* 树节点 -> 图形 */
  function fromTree(root) {
    const nodes = [];
    const walk = (node, parentId, depth) => {
      if (!node || depth > 12) return;
      const id = rid();
      nodes.push({
        id, t: String(node.t == null ? '' : node.t), x: 0, y: 0,
        p: parentId, img: '', wide: false
      });
      (node.c || []).forEach(c => walk(c, id, depth + 1));
    };
    walk(root && root.t !== undefined ? root : { t: '（空导图）', c: [] }, null, 0);
    const g = layout({ v: 1, nodes });
    return g;
  }
  function fromOutlineJSON(obj) { return fromTree(obj); }

  /* 缩进文本 -> 图形 */
  function fromIndentText(text) {
    const lines = String(text || '').split('\n').filter(l => l.trim());
    if (!lines.length) return { v: 1, nodes: [] };
    const parsed = lines.map(line => {
      const m = line.match(/^([ \t]*)(.*)$/);
      let indent = 0;
      for (const ch of m[1]) indent += (ch === '\t' ? 2 : 1);
      const t = m[2].replace(/^[-*+•]\s*/, '').replace(/^#+\s*/, '').trim();
      return { indent, t };
    }).filter(x => x.t);
    if (!parsed.length) return { v: 1, nodes: [] };

    if (parsed.length > 1 && parsed.every(x => x.indent === 0)) {
      return layout({ v: 1, nodes: fromTree({
        t: parsed[0].t, c: parsed.slice(1).map(x => ({ t: x.t, c: [] }))
      }).nodes });
    }

    const root = { t: '（导图）', c: [] };
    const stack = [{ node: root, indent: -1 }];
    parsed.forEach(x => {
      while (stack.length > 1 && stack[stack.length - 1].indent >= x.indent) stack.pop();
      const node = { t: x.t, c: [] };
      stack[stack.length - 1].node.c.push(node);
      stack.push({ node, indent: x.indent });
    });
    const real = root.c.length === 1 ? root.c[0] : root;
    return fromTree(real);
  }

  /* 任意旧内容 -> 图形 */
  function parse(content) {
    const s = String(content || '').trim();
    if (!s) return { v: 1, nodes: [] };
    if (isGraph(s)) { try { return normalize(JSON.parse(s)); } catch (e) { /* fallthrough */ } }
    if (isOutline(s)) { try { return fromOutlineJSON(JSON.parse(s)); } catch (e) { /* fallthrough */ } }
    return fromIndentText(content);
  }

  const serialize = graph => JSON.stringify(normalize(graph));

  /* 图形 -> 缩进文本（默写、切回笔记、导出都能用） */
  function toOutlineText(graph, withImageNote) {
    const byId = {};
    (graph.nodes || []).forEach(n => { byId[n.id] = n; });
    const kids = {};
    (graph.nodes || []).forEach(n => { const k = n.p || '__root'; (kids[k] = kids[k] || []).push(n); });
    let out = '';
    const walk = (n, depth) => {
      out += '  '.repeat(depth) + (n.t || '') + (n.img && withImageNote ? '［此处有图片］' : '') + '\n';
      (kids[n.id] || []).forEach(c => walk(c, depth + 1));
    };
    (kids['__root'] || []).forEach(n => walk(n, 0));
    return out;
  }

  function excerpt(graph, n) {
    n = n || 160;
    const t = (graph && graph.nodes ? graph.nodes : []).map(x => x.t).filter(x => !isBlank(x)).join(' / ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  /* ---------------- 自动布局 ---------------- */
  function depthMap(graph) {
    const byId = {};
    graph.nodes.forEach(n => { byId[n.id] = n; });
    graph.nodes.forEach(n => {
      let d = 0, cur = n, guard = 0;
      while (cur.p && byId[cur.p] && guard++ < 40) { cur = byId[cur.p]; d++; }
      n._d = d;
    });
    return byId;
  }

  function layout(graph) {
    const byId = depthMap(graph);
    const kids = {};
    graph.nodes.forEach(n => { const k = n.p || '__root'; (kids[k] = kids[k] || []).push(n); });

    let cursor = 0;
    const rowOf = {};
    const visited = {};
    const place = (n, depth) => {
      if (!n || visited[n.id] || depth > 14) return;
      visited[n.id] = 1;
      n.x = ORIGIN_X + depth * GAP_X;
      const ks = kids[n.id] || [];
      if (!ks.length) { rowOf[n.id] = cursor++; }
      else {
        ks.forEach(k => place(k, depth + 1));
        const done = ks.filter(k => rowOf[k.id] !== undefined);
        if (!done.length) rowOf[n.id] = cursor++;
        else if (done.length === 1) rowOf[n.id] = rowOf[done[0].id];
        else rowOf[n.id] = (rowOf[done[0].id] + rowOf[done[done.length - 1].id]) / 2;
      }
    };
    (kids['__root'] || []).forEach(n => place(n, 0));
    graph.nodes.forEach(n => { if (rowOf[n.id] === undefined) { rowOf[n.id] = cursor++; } });

    graph.nodes.forEach(n => { n.y = ORIGIN_Y + (rowOf[n.id] || 0) * GAP_Y; });
    return graph;
  }

  /* ---------------- 图片压缩（统一压到 800px 宽，省本地存储） ---------------- */
  function compressImage(file, maxW) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('没有选到文件'));
      if (!/^image\//.test(file.type || '')) return reject(new Error('这个文件不是图片'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('文件读不出来'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('这张图打不开，换个格式试试'));
        img.onload = () => {
          const max = maxW || 800;
          const scale = Math.min(1, max / (img.width || max));
          const w = Math.max(1, Math.round((img.width || max) * scale));
          const h = Math.max(1, Math.round((img.height || max) * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let out;
          try { out = cv.toDataURL('image/jpeg', 0.82); }
          catch (e) { out = cv.toDataURL(); }
          resolve({ dataUrl: out, w, h });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- 画布 ---------------- */

  function mount(stage, graph, opts) {
    opts = opts || {};
    const readonly = !!opts.readonly;
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () { };

    let zoom = 1, panX = 24, panY = 18;
    let sel = null;
    let revealMode = false;

    stage.innerHTML = '';
    const canvas = el('div', 'mmc-canvas');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mmc-svg');
    svg.setAttribute('width', '4000');
    svg.setAttribute('height', '3000');
    canvas.appendChild(svg);
    const layer = el('div', 'mmc-layer');
    canvas.appendChild(layer);
    stage.appendChild(canvas);
    stage.style.touchAction = readonly ? 'auto' : 'none';

    if (!graph.nodes.length) {
      const empty = el('div', 'mmc-empty');
      empty.textContent = readonly ? '这张导图还是空的。' : '还没有节点。点上面的「＋ 子节点」开始画。';
      stage.appendChild(empty);
    }

    function applyTransform() {
      canvas.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    }

    function depthOf(n) {
      const byId = {};
      graph.nodes.forEach(x => { byId[x.id] = x; });
      let d = 0, cur = n, g = 0;
      while (cur.p && byId[cur.p] && g++ < 40) { cur = byId[cur.p]; d++; }
      return d;
    }

    /* 建节点 DOM */
    const doms = {};
    graph.nodes.forEach(n => {
      const d = el('div', 'mmc-node l' + Math.min(depthOf(n), 2));
      d.dataset.id = n.id;
      if (n.wide) d.classList.add('wide');
      const tx = el('div', 'mtx');
      tx.textContent = n.t || '';
      d.appendChild(tx);
      if (n.img) {
        const im = el('img', 'mimg');
        im.src = n.img;
        im.draggable = false;
        d.appendChild(im);
      }
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
      if (readonly) d.style.cursor = 'default';
      layer.appendChild(d);
      doms[n.id] = d;
    });

    /* 量尺寸 + 画连线 */
    function measure() {
      graph.nodes.forEach(n => {
        const d = doms[n.id];
        if (!d) return;
        n._w = d.offsetWidth || 120;
        n._h = d.offsetHeight || 36;
      });
    }
    function drawEdges() {
      const byId = {};
      graph.nodes.forEach(n => { byId[n.id] = n; });
      let d = '';
      graph.nodes.forEach(n => {
        const p = n.p ? byId[n.p] : null;
        if (!p) return;
        const x1 = p.x + (p._w || 120), y1 = p.y + (p._h || 36) / 2;
        const x2 = n.x, y2 = n.y + (n._h || 36) / 2;
        const mx = (x1 + x2) / 2;
        d += 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + ' ';
      });
      svg.innerHTML = d ? '<path d="' + d + '"></path>' : '';
    }
    function place(n) {
      const d = doms[n.id];
      if (!d) return;
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
    }
    function refresh(reMeasure) {
      if (reMeasure !== false) measure();
      graph.nodes.forEach(place);
      drawEdges();
    }

    function setSel(id) {
      sel = id || null;
      graph.nodes.forEach(n => {
        const d = doms[n.id];
        if (d) d.classList.toggle('sel', n.id === sel);
      });
      onSelect(sel);
    }

    /* ---------- 交互：拖节点 / 平移画布 ---------- */
    let drag = null;
    function onDown(e) {
      const nodeEl = e.target.closest ? e.target.closest('.mmc-node') : null;
      if (revealMode && nodeEl) {
        nodeEl.classList.add('revealed');
        if (opts.onReveal) opts.onReveal(nodeEl.dataset.id);
        return;
      }
      const rect = stage.getBoundingClientRect();
      if (nodeEl) {
        const id = nodeEl.dataset.id;
        const n = graph.nodes.find(x => x.id === id);
        if (!n) return;
        setSel(id);
        if (readonly) return;
        drag = { type: 'node', node: n, sx: e.clientX, sy: e.clientY, x0: n.x, y0: n.y, moved: false };
      } else {
        if (!readonly) setSel(null);
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: panX, py: panY };
        stage.classList.add('grabbing');
      }
      drag._left = rect.left;
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (drag.type === 'node') {
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        drag.node.x = drag.x0 + dx / zoom;
        drag.node.y = drag.y0 + dy / zoom;
        place(drag.node);
        drawEdges();
      } else {
        panX = drag.px + dx; panY = drag.py + dy;
        applyTransform();
      }
    }
    function onUp() {
      if (drag && drag.type === 'pan') stage.classList.remove('grabbing');
      drag = null;
    }
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    if (!readonly) {
      stage.addEventListener('wheel', e => {
        const r = stage.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomTo(zoom * k, mx, my);
        e.preventDefault();
      }, { passive: false });
      stage.addEventListener('dblclick', e => {
        const nodeEl = e.target.closest ? e.target.closest('.mmc-node') : null;
        if (nodeEl && opts.onDblClick) opts.onDblClick(nodeEl.dataset.id);
      });
    }

    function zoomTo(nz, mx, my) {
      nz = clamp(nz, ZOOM_MIN, ZOOM_MAX);
      if (mx == null) { mx = stage.clientWidth / 2; my = stage.clientHeight / 2; }
      panX = mx - (mx - panX) * (nz / zoom);
      panY = my - (my - panY) * (nz / zoom);
      zoom = nz;
      applyTransform();
    }

    applyTransform();
    refresh();
    window.setTimeout(() => refresh(), 60);

    /* ---------- 控制器 ---------- */
    const ctrl = {
      graph,
      isReadonly: () => readonly,
      selectedId: () => sel,

      select: setSel,

      refresh: () => refresh(),

      retext(id, text) {
        const n = graph.nodes.find(x => x.id === id);
        if (!n) return;
        n.t = text;
        const d = doms[id];
        if (d) {
          const tx = d.querySelector('.mtx');
          if (tx) tx.textContent = text;
        }
        refresh();
      },

      setWide(id, wide) {
        const n = graph.nodes.find(x => x.id === id);
        if (!n) return;
        n.wide = !!wide;
        const d = doms[id];
        if (d) d.classList.toggle('wide', !!wide);
        refresh();
      },

      setImage(id, dataUrl) {
        const n = graph.nodes.find(x => x.id === id);
        if (!n) return;
        const d = doms[id];
        n.img = dataUrl || '';
        if (d) {
          const old = d.querySelector('.mimg');
          if (old) old.remove();
          if (n.img) {
            const im = el('img', 'mimg');
            im.src = n.img; im.draggable = false;
            d.appendChild(im);
          }
        }
        refresh();
      },

      addChild(parentId, text) {
        const p = parentId || sel || (graph.nodes[0] && graph.nodes[0].id) || null;
        const pn = graph.nodes.find(x => x.id === p);
        const n = {
          id: rid(), t: text == null ? '新节点' : text, x: 0, y: 0,
          p: pn ? pn.id : null, img: '', wide: false
        };
        if (pn) { n.x = pn.x + GAP_X; n.y = pn.y + (pn._h || 36) + 12; }
        else { n.x = ORIGIN_X; n.y = ORIGIN_Y; }
        graph.nodes.push(n);
        buildNode(n);
        refresh();
        setSel(n.id);
        return n.id;
      },

      addSibling(id, text) {
        const cur = graph.nodes.find(x => x.id === (id || sel));
        if (!cur) return this.addChild(null, text);
        const n = {
          id: rid(), t: text == null ? '新节点' : text, x: cur.x, y: cur.y + (cur._h || 36) + 12,
          p: cur.p, img: '', wide: false
        };
        graph.nodes.push(n);
        buildNode(n);
        refresh();
        setSel(n.id);
        return n.id;
      },

      /* 画布空白处双击：加一个自由节点 */
      addFree(text) {
        const n = { id: rid(), t: text == null ? '新节点' : text, x: ORIGIN_X + 60, y: ORIGIN_Y + 60, p: null, img: '', wide: false };
        graph.nodes.push(n);
        buildNode(n);
        refresh();
        setSel(n.id);
        return n.id;
      },

      delSel() {
        if (!sel) return false;
        const kill = {};
        const collect = id => { kill[id] = 1; graph.nodes.filter(x => x.p === id).forEach(x => collect(x.id)); };
        collect(sel);
        graph.nodes = graph.nodes.filter(n => !kill[n.id]);
        Object.keys(kill).forEach(id => { if (doms[id]) { doms[id].remove(); delete doms[id]; } });
        sel = null;
        ctrl.graph = graph;
        refresh();
        onSelect(null);
        return true;
      },

      autoLayout() {
        layout(graph);
        refresh();
        ctrl.fit();
      },

      fit() {
        if (!graph.nodes.length) return;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        graph.nodes.forEach(n => {
          x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
          x2 = Math.max(x2, n.x + (n._w || 120)); y2 = Math.max(y2, n.y + (n._h || 36));
        });
        const pad = 40;
        const sw = stage.clientWidth || 600, sh = stage.clientHeight || 400;
        const k = Math.min((sw - pad * 2) / Math.max(1, x2 - x1), (sh - pad * 2) / Math.max(1, y2 - y1), 1.1);
        zoom = clamp(k, ZOOM_MIN, ZOOM_MAX);
        panX = (sw - (x2 - x1) * zoom) / 2 - x1 * zoom;
        panY = Math.max(16, (sh - (y2 - y1) * zoom) / 2 - y1 * zoom);
        applyTransform();
      },

      zoomBy(f) { zoomTo(zoom * f); },
      zoomLevel: () => Math.round(zoom * 100),

      /* 默写：全部盖住，点一个揭一个 */
      setRevealMode(on) {
        revealMode = !!on;
        Object.keys(doms).forEach(id => {
          doms[id].classList.toggle('hidetext', revealMode);
          if (!revealMode) doms[id].classList.remove('revealed');
        });
      },
      revealAll() { Object.keys(doms).forEach(id => doms[id].classList.add('revealed')); },
      revealStats() {
        const all = Object.keys(doms).length;
        const done = Object.keys(doms).filter(id => doms[id].classList.contains('revealed')).length;
        return { total: all, revealed: done };
      },

      serialize() { return serialize(graph); },
      excerpt: n => excerpt(graph, n),
      destroy() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
    };

    function buildNode(n) {
      const d = el('div', 'mmc-node l' + Math.min(depthOf(n), 2));
      d.dataset.id = n.id;
      if (n.wide) d.classList.add('wide');
      const tx = el('div', 'mtx');
      tx.textContent = n.t || '';
      d.appendChild(tx);
      if (n.img) {
        const im = el('img', 'mimg');
        im.src = n.img; im.draggable = false;
        d.appendChild(im);
      }
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
      if (readonly) d.style.cursor = 'default';
      layer.appendChild(d);
      doms[n.id] = d;
    }

    return ctrl;
  }

  window.CY_MIND = {
    mount, parse, serialize, normalize, layout, toOutlineText,
    isGraph, isOutline, fromOutlineJSON, fromIndentText, fromTree,
    excerpt, compressImage,
    blank: () => layout({ v: 1, nodes: [{ id: rid(), t: '中心主题', x: 0, y: 0, p: null, img: '', wide: false }] })
  };
})();
