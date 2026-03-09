// ── グローバル変数 ─────────────────────────────────────────────────
let ITEMS, TEXT, RESEARCH;
let itemMap, MAX_STAGE, FAMILY_COUNT;
let ALL_ROWS = [];
let startIdx = null, endIdx = null;

// ── JSON 読み込み ──────────────────────────────────────────────────
async function loadData() {
  try {
    const [itemsRes, textRes, researchRes] = await Promise.all([
      fetch('items.json'),
      fetch('text.json'),
      fetch('research.json'),
    ]);
    if (!itemsRes.ok || !textRes.ok || !researchRes.ok) throw new Error('fetch failed');
    [ITEMS, TEXT, RESEARCH] = await Promise.all([
      itemsRes.json(),
      textRes.json(),
      researchRes.json(),
    ]);
  } catch (e) {
    document.getElementById('loading').innerHTML =
      `<div class="err">JSONファイルの読み込みに失敗しました。<br>items.json / text.json / research.json を同じフォルダに置いてください。</div>`;
    return false;
  }
  return true;
}

// ── 初期化 ────────────────────────────────────────────────────────
async function init() {
  const ok = await loadData();
  if (!ok) return;

  itemMap      = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  MAX_STAGE    = Math.max(...Object.keys(RESEARCH).map(Number));
  FAMILY_COUNT = TEXT.family.length;

  // ALL_ROWS 構築（type系はfamily数分展開）
  Object.keys(RESEARCH).sort((a, b) => +a - +b).forEach(s => {
    RESEARCH[s].forEach(entry => {
      const [t0] = entry.text;
      if (t0 === -1) {
        ALL_ROWS.push({ globalIdx: ALL_ROWS.length, stage: +s, entry, familyIdx: -1 });
      } else {
        TEXT.family.forEach((_, fIdx) => {
          ALL_ROWS.push({ globalIdx: ALL_ROWS.length, stage: +s, entry, familyIdx: fIdx });
        });
      }
    });
  });

  buildStages();
  buildItemSel();
  updateRangeBar();

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

// ── RANGE ─────────────────────────────────────────────────────────
const lo = () => startIdx !== null && endIdx !== null ? Math.min(startIdx, endIdx) : startIdx;
const hi = () => startIdx !== null && endIdx !== null ? Math.max(startIdx, endIdx) : startIdx;

function rowState(gIdx) {
  const l = lo(), h = hi();
  if (l === null) return 'none';
  if (h === null) return gIdx === l ? 'start' : 'none';
  if (gIdx === l) return 'start';
  if (gIdx === h) return 'end';
  if (gIdx > l && gIdx < h) return 'range';
  return 'none';
}

function resetRange() {
  startIdx = null; endIdx = null;
  refreshAllRows();
  updateRangeBar();
  document.getElementById('rResult').style.display = 'none';
}

function handleRowClick(gIdx) {
  if (startIdx === null) {
    startIdx = gIdx;
  } else if (endIdx === null) {
    if (gIdx === startIdx) { startIdx = null; }
    else { endIdx = gIdx; }
  } else {
    startIdx = gIdx; endIdx = null;
  }
  refreshAllRows();
  updateRangeBar();
  // 始点・終点が揃ったら自動集計
  if (startIdx !== null && endIdx !== null) calcResearch();
}

function refreshAllRows() {
  document.querySelectorAll('.res-row').forEach(el => {
    const gIdx = +el.dataset.gidx;
    const st = rowState(gIdx);
    el.classList.toggle('is-start', st === 'start');
    el.classList.toggle('is-end',   st === 'end');
    el.classList.toggle('in-range', st === 'range');
    const pin = el.querySelector('.row-pin');
    if (st === 'start') { pin.textContent = 'S'; pin.className = 'row-pin pin-s'; }
    else if (st === 'end') { pin.textContent = 'E'; pin.className = 'row-pin pin-e'; }
    else { pin.textContent = String(gIdx + 1); pin.className = 'row-pin pin-n'; }
  });
  // stage tab インジケーター
  document.querySelectorAll('.stage-tab').forEach(tab => {
    const s = +tab.dataset.stage;
    const indices = ALL_ROWS.filter(r => r.stage === s).map(r => r.globalIdx);
    const l = lo(), h = hi();
    tab.classList.toggle('has-start', startIdx !== null && indices.includes(startIdx));
    tab.classList.toggle('has-end',   endIdx   !== null && indices.includes(endIdx));
    const inRange = l !== null && h !== null && indices.some(i => i >= l && i <= h);
    tab.classList.toggle('in-range', inRange);
  });
}

function updateRangeBar() {
  const l = lo(), h = hi();
  const startRow = l !== null ? ALL_ROWS[l] : null;
  const endRow   = h !== null ? ALL_ROWS[h] : null;
  document.getElementById('rbStart').textContent = startRow ? shortLabel(startRow) : '未設定';
  document.getElementById('rbEnd').textContent   = endRow   ? shortLabel(endRow)   : '未設定';
  const count = l !== null && h !== null ? h - l + 1 : (l !== null ? 1 : 0);
  document.getElementById('rbCount').textContent = count + '件';
  document.getElementById('rbHint').textContent =
    startIdx === null ? '始点をクリックしてください' :
    endIdx   === null ? '終点をクリックしてください' : '';
}

function shortLabel(row) {
  const [t0, t1] = row.entry.text;
  if (t0 === -1) return `段${row.stage} ${TEXT.misc[t1].slice(0, 9)}`;
  return `段${row.stage} ${TEXT.type[t0]}(${TEXT.family[row.familyIdx]})`;
}

// ── HELPERS ───────────────────────────────────────────────────────

// rare:0 まで再帰展開した原材料を返す（従来通り）
function calcMaterials(itemId, amount = 1) {
  const item = itemMap[itemId];
  if (!item) return {};
  if (item.rare === 0) return { [item.name]: amount };
  const result = {};
  for (const n of item.need) {
    const sub = calcMaterials(n.id, n.amount * amount);
    for (const [name, cnt] of Object.entries(sub)) result[name] = (result[name] ?? 0) + cnt;
  }
  return result;
}

// アイテム1種を展開して rareごとに総計を返す
// 自分自身のrareに自分を加算 → 子を再帰展開（子は自分のレベルに加算される）
function calcMaterialsByRare(itemId, amount = 1, result = {}) {
  const item = itemMap[itemId];
  if (!item) return result;
  const r = item.rare;
  if (!result[r]) result[r] = {};
  result[r][item.name] = (result[r][item.name] ?? 0) + amount;
  // rare > 0 なら子素材を再帰集計（子は子自身のrareレベルに加算）
  if (r > 0 && item.need) {
    for (const n of item.need) {
      calcMaterialsByRare(n.id, n.amount * amount, result);
    }
  }
  return result;
}

// needリストをまとめてrareごと集計（研究・素材タブ共通）
function mergeMaterialsByRare(needList) {
  const merged = {};
  for (const { id, amount } of needList) {
    const byRare = calcMaterialsByRare(id, amount);
    for (const [r, items] of Object.entries(byRare)) {
      if (!merged[r]) merged[r] = {};
      for (const [name, cnt] of Object.entries(items)) {
        merged[r][name] = (merged[r][name] ?? 0) + cnt;
      }
    }
  }
  return merged;
}

function fmtTime(min) {
  if (min < 60) return min + '分';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? h + 'h' + m + 'm' : h + '時間';
}

function fmtMoney(n) { return n.toLocaleString('ja-JP') + 'G'; }

function effectBadge(t0, t1) {
  if (t0 === -1) return `<span class="eb em">${TEXT.misc[t1]}</span>`;
  return `<span class="eb e${t0}">${TEXT.type[t0]} +${t1}</span>`;
}

const RARE_LABELS = { 0: '原材料　Rare 0', 1: '中間素材 Rare 1', 2: '中間素材 Rare 2', 3: '中間素材 Rare 3' };

function renderMatsByRare(byRare, containerId) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  const rares = Object.keys(byRare).map(Number).sort((a, b) => b - a);
  if (!rares.length) { wrap.innerHTML = '<div class="empty">素材なし</div>'; return; }
  rares.forEach(r => {
    const items = byRare[r];
    const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return;
    const sec = document.createElement('div');
    sec.className = 'mat-section';
    const label = document.createElement('div');
    label.className = `mat-section-label rl${r}`;
    label.textContent = RARE_LABELS[r] ?? `Rare ${r}`;
    sec.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'mgrid';
    sorted.forEach(([name, cnt]) => {
      const d = document.createElement('div');
      d.className = `mc rc${r}`;
      // rare > 0 の中間素材はホバーで必要素材の総量を表示
      let tooltip = '';
      if (r > 0) {
        const item = ITEMS.find(i => i.name === name);
        if (item && item.need) {
          const rows = item.need.map(n => {
            const ni = itemMap[n.id];
            const nm = ni ? ni.name : `ID:${n.id}`;
            const total = n.amount * cnt; // 1個分 × 総数
            return `<div class="tt-row"><span class="tt-name">${nm}</span><span class="tt-amt">× ${total}</span></div>`;
          }).join('');
          tooltip = `<div class="mc-tooltip"><div class="tt-title">素材 (${name} ×${cnt})</div>${rows}</div>`;
        }
      }
      d.innerHTML = `<span class="mn">${name}</span><span class="ma">× ${cnt}</span>${tooltip}`;
      grid.appendChild(d);
    });
    sec.appendChild(grid);
    wrap.appendChild(sec);
  });
}

// ── STAGE TABS & PAGES ────────────────────────────────────────────
function buildStages() {
  const tabsEl  = document.getElementById('stageTabs');
  const pagesEl = document.getElementById('stagePages');

  for (let s = 1; s <= MAX_STAGE; s++) {
    const tab = document.createElement('button');
    tab.className = 'stage-tab' + (s === 1 ? ' on' : '');
    tab.dataset.stage = s;
    tab.innerHTML = `段階 ${s}<span class="stab-dot dot-s"></span><span class="stab-dot dot-e"></span>`;
    tab.addEventListener('click', () => switchStage(s));
    tabsEl.appendChild(tab);

    const page = document.createElement('div');
    page.className = 'stage-page' + (s === 1 ? ' on' : '');
    page.id = `page-${s}`;

    ALL_ROWS.filter(r => r.stage === s).forEach(row => {
      const [t0, t1] = row.entry.text;
      const isType = t0 >= 0;
      const needItem = itemMap[row.entry.need[0].id];
      const needName = needItem ? needItem.name : `ID:${row.entry.need[0].id}`;
      const rc = needItem ? `r${needItem.rare}` : '';
      const ftag = isType ? `<span class="ftag">${TEXT.family[row.familyIdx]}</span>` : '';

      const div = document.createElement('div');
      div.className = 'res-row';
      div.dataset.gidx = row.globalIdx;
      div.innerHTML = `
        <div class="row-pin pin-n">${row.globalIdx + 1}</div>
        <div class="row-body">
          <div class="row-name">${effectBadge(t0, t1)}${ftag}</div>
          <div class="row-need">${needName}<span class="rb2 ${rc}">R${needItem?.rare ?? '?'}</span> ×${row.entry.need[0].amount}</div>
          <div class="row-meta">${fmtMoney(row.entry.money)} / ${fmtTime(row.entry.time)}</div>
        </div>
      `;
      div.addEventListener('click', () => handleRowClick(row.globalIdx));
      page.appendChild(div);
    });
    pagesEl.appendChild(page);
  }
}

function switchStage(s) {
  document.querySelectorAll('.stage-tab').forEach(t => t.classList.toggle('on', +t.dataset.stage === s));
  document.querySelectorAll('.stage-page').forEach(p => p.classList.toggle('on', p.id === `page-${s}`));
}

// ── CALC RESEARCH ─────────────────────────────────────────────────
function calcResearch() {
  const l = lo(), h = hi();
  if (l === null || h === null) return;

  const allNeed = [];
  let totalMoney = 0, totalTime = 0;
  for (let i = l; i <= h; i++) {
    const row = ALL_ROWS[i];
    if (!row) continue;
    totalMoney += row.entry.money;
    totalTime  += row.entry.time;
    row.entry.need.forEach(n => allNeed.push(n));
  }
  const byRare = mergeMaterialsByRare(allNeed);
  const totalMat = Object.values(byRare[0] ?? {}).reduce((a, b) => a + b, 0);

  document.getElementById('rSumbar').innerHTML = `
    <div class="si"><div class="sl">範囲</div><div class="sv">${h - l + 1}件</div></div>
    <div class="si"><div class="sl">合計コスト</div><div class="sv gold">${fmtMoney(totalMoney)}</div></div>
    <div class="si"><div class="sl">合計時間</div><div class="sv">${fmtTime(totalTime)}</div></div>
    <div class="si"><div class="sl">原材料合計</div><div class="sv g">${totalMat}個</div></div>
  `;
  renderMatsByRare(byRare, 'rMats');
  const area = document.getElementById('rResult');
  area.style.display = 'block';
  area.style.animation = 'none';
  requestAnimationFrame(() => { area.style.animation = 'fadeup .25s ease'; });
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── CRAFT ─────────────────────────────────────────────────────────
function buildItemSel() {
  const sel = document.getElementById('itemSel');
  [3, 2, 1].forEach(r => {
    const grp = ITEMS.filter(i => i.rare === r);
    if (!grp.length) return;
    const og = document.createElement('optgroup');
    og.label = `── Rare ${r} ──`;
    grp.forEach(item => {
      const o = document.createElement('option');
      o.value = item.id; o.textContent = item.name;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
}

function calcCraft() {
  const itemId = parseInt(document.getElementById('itemSel').value);
  const amount = Math.max(1, parseInt(document.getElementById('iAmt').value) || 1);
  const item = itemMap[itemId];
  if (!item) return;
  const byRare = calcMaterialsByRare(itemId, amount);
  const raw = byRare[0] ?? {};
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const kinds = Object.keys(raw).length;
  document.getElementById('cSumbar').innerHTML = `
    <div class="si"><div class="sl">アイテム</div><div class="sv">${item.name} <span class="rb2 r${item.rare}">R${item.rare}</span></div></div>
    <div class="si"><div class="sl">必要数</div><div class="sv">× ${amount}</div></div>
    <div class="si"><div class="sl">原材料種類</div><div class="sv">${kinds}種</div></div>
    <div class="si"><div class="sl">原材料合計</div><div class="sv g">${total}個</div></div>
  `;
  renderMatsByRare(byRare, 'cMats');
  const area = document.getElementById('cResult');
  area.style.display = 'block';
  area.style.animation = 'none';
  requestAnimationFrame(() => { area.style.animation = 'fadeup .25s ease'; });
}

// ── MAIN TABS ─────────────────────────────────────────────────────
function switchMain(name) {
  document.querySelectorAll('.main-tab').forEach((b, i) => b.classList.toggle('on', ['research', 'craft'][i] === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === `tab-${name}`));
}

// ── START ─────────────────────────────────────────────────────────
init();