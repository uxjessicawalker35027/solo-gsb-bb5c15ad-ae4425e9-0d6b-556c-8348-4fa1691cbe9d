'use strict';

const MIN_AXES = 2;
const MAX_AXES = 4;
const MIN_GEARS = 2;
const MAX_GEARS = 12;

const axisRowsBox = document.getElementById('axis-rows');
const gearRowsBox = document.getElementById('gear-rows');
const form = document.getElementById('layout-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const noSolution = document.getElementById('no-solution');
const bestPanel = document.getElementById('best-panel');
const bestMeta = document.getElementById('best-meta');
const stageTable = document.getElementById('stage-table');
const axisTable = document.getElementById('axis-table');

const EXAMPLE_AXES = [0, 50, 110];
const EXAMPLE_MODULE = 2;
const EXAMPLE_GEARS = [
  { id: 'G1', teeth: 10 },
  { id: 'G2', teeth: 40 },
  { id: 'G3', teeth: 20 },
  { id: 'G4', teeth: 30 },
  { id: 'G5', teeth: 24 },
  { id: 'G6', teeth: 36 },
  { id: 'G7', teeth: 15 },
  { id: 'G8', teeth: 45 },
];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 轴心坐标编辑（2～4 个，依次排列） ---------------- */

function refreshAxisLabels() {
  Array.from(axisRowsBox.children).forEach((row, i) => {
    row.querySelector('.axis-label').textContent = `轴 ${i + 1}`;
  });
}

function addAxisRow(value = '') {
  const row = el('div', 'axis-row');
  row.innerHTML = `
    <span class="axis-label"></span>
    <input class="axis-pos-input" type="number" min="-1000000000" max="1000000000" step="1" placeholder="整数坐标" value="${value}" />
    <button type="button" class="btn danger-ghost" title="删除该轴">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (axisRowsBox.children.length <= MIN_AXES) {
      alert(`至少保留 ${MIN_AXES} 根轴`);
      return;
    }
    row.remove();
    refreshAxisLabels();
  });
  axisRowsBox.appendChild(row);
  refreshAxisLabels();
}

document.getElementById('btn-add-axis').addEventListener('click', () => {
  if (axisRowsBox.children.length >= MAX_AXES) {
    alert(`最多 ${MAX_AXES} 根轴`);
    return;
  }
  // 新轴默认坐标：上一轴坐标 + 50（便于继续排布）
  const lastInput = axisRowsBox.lastElementChild
    ? axisRowsBox.lastElementChild.querySelector('.axis-pos-input')
    : null;
  const prev = lastInput && lastInput.value.trim() !== '' ? Number(lastInput.value) : NaN;
  addAxisRow(Number.isInteger(prev) ? prev + 50 : '');
});

function collectAxes() {
  const axes = [];
  for (const row of axisRowsBox.querySelectorAll('.axis-row')) {
    const raw = row.querySelector('.axis-pos-input').value.trim();
    const v = Number(raw);
    if (raw === '' || !Number.isInteger(v)) throw new Error('轴心坐标需为整数');
    axes.push(v);
  }
  if (axes.length < MIN_AXES || axes.length > MAX_AXES) {
    throw new Error(`需填写 ${MIN_AXES}～${MAX_AXES} 个轴心坐标`);
  }
  return axes;
}

/* ---------------- 齿轮清单编辑（2～12 枚） ---------------- */

function addGearRow(id = '', teeth = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <input class="gear-id-input" placeholder="如 G1" value="${id}" />
    <input class="gear-teeth-input" type="number" min="1" max="100000" step="1" placeholder="齿数" value="${teeth}" />
    <button type="button" class="btn danger-ghost" title="删除该齿轮">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    if (gearRowsBox.children.length <= MIN_GEARS) {
      alert(`至少保留 ${MIN_GEARS} 枚齿轮`);
      return;
    }
    row.remove();
  });
  gearRowsBox.appendChild(row);
}

document.getElementById('btn-add-gear').addEventListener('click', () => {
  if (gearRowsBox.children.length >= MAX_GEARS) {
    alert(`最多 ${MAX_GEARS} 枚齿轮`);
    return;
  }
  addGearRow();
});

function fillExample() {
  axisRowsBox.innerHTML = '';
  EXAMPLE_AXES.forEach((x) => addAxisRow(x));
  document.getElementById('module').value = String(EXAMPLE_MODULE);
  document.getElementById('target').value = '1/6';
  document.getElementById('tolerance').value = '5%';
  gearRowsBox.innerHTML = '';
  EXAMPLE_GEARS.forEach((g) => addGearRow(g.id, g.teeth));
}

document.getElementById('btn-example').addEventListener('click', fillExample);

/* 初始：示例数据 */
fillExample();

function collectGears() {
  const gears = [];
  const ids = new Set();
  for (const row of gearRowsBox.querySelectorAll('.gear-row')) {
    const id = row.querySelector('.gear-id-input').value.trim();
    const teethRaw = row.querySelector('.gear-teeth-input').value.trim();
    if (!id && !teethRaw) continue; // 空行忽略
    if (!id) throw new Error('存在未填写编号的齿轮行');
    if (ids.has(id)) throw new Error(`齿轮编号重复：${id}`);
    ids.add(id);
    const teeth = Number(teethRaw);
    if (!Number.isInteger(teeth) || teeth < 1) throw new Error(`齿轮 ${id} 的齿数需为正整数`);
    gears.push({ id, teeth });
  }
  if (gears.length < MIN_GEARS) {
    throw new Error(`请至少填写 ${MIN_GEARS} 枚齿轮（最多 ${MAX_GEARS} 枚）`);
  }
  if (gears.length > MAX_GEARS) throw new Error(`齿轮数量不能超过 ${MAX_GEARS} 枚`);
  return gears;
}

/* ---------------- 结果渲染 ---------------- */

function renderBest(best) {
  bestMeta.innerHTML =
    `实际总速比 <strong class="frac">${best.ratio.num}/${best.ratio.den}</strong>` +
    ` ≈ <strong>${best.ratio.decimal}</strong>` +
    ` &nbsp;|&nbsp; 相对误差 <strong>${best.errorPercent}%</strong>`;

  // 各级传动表
  stageTable.innerHTML = `
    <thead><tr>
      <th>级</th>
      <th>轴区间（坐标）</th>
      <th>轴距</th>
      <th>所需齿数和</th>
      <th>主动轮（编号 / 齿数）</th>
      <th>从动轮（编号 / 齿数）</th>
      <th>本级速比（主动/从动）</th>
    </tr></thead>`;
  const stb = el('tbody');
  best.stages.forEach((s) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>${s.stage}</td>
      <td>轴 ${s.fromAxis}（${s.fromPosition}） → 轴 ${s.toAxis}（${s.toPosition}）</td>
      <td>${s.distance}</td>
      <td>${s.teethSum}</td>
      <td><span class="gear-id">${s.drive.id}</span> · ${s.drive.teeth} 齿</td>
      <td><span class="gear-id">${s.driven.id}</span> · ${s.driven.teeth} 齿</td>
      <td class="frac">${s.stageRatio.num}/${s.stageRatio.den} ≈ ${s.stageRatio.decimal}</td>`;
    stb.appendChild(tr);
  });
  stageTable.appendChild(stb);

  // 逐轴安装明细表（中间轴同轴固定两枚齿轮）
  axisTable.innerHTML = `
    <thead><tr>
      <th>轴</th><th>轴心坐标</th><th>安装齿轮（同轴固定）</th>
    </tr></thead>`;
  const atb = el('tbody');
  best.axes.forEach((a) => {
    const tr = el('tr');
    const gearsHtml = a.gears
      .map(
        (g) =>
          `<div><span class="gear-id">${g.id}</span> · ${g.teeth} 齿` +
          ` <span class="torque-rated">（第 ${g.stage} 级${g.role === 'drive' ? '主动' : '从动'}轮）</span></div>`
      )
      .join('');
    tr.innerHTML = `<td>轴 ${a.axis}</td><td>${a.position}</td><td>${gearsHtml}</td>`;
    atb.appendChild(tr);
  });
  axisTable.appendChild(atb);
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    const moduleRaw = document.getElementById('module').value.trim();
    const module = Number(moduleRaw);
    if (moduleRaw === '' || !Number.isInteger(module) || module < 1) {
      throw new Error('模数需为正整数');
    }
    payload = {
      axes: collectAxes(),
      module,
      target: document.getElementById('target').value,
      tolerance: document.getElementById('tolerance').value,
      gears: collectGears(),
    };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '轴位装配失败');

    resultPanel.hidden = false;
    noSolution.hidden = true;
    bestPanel.hidden = true;

    resultSummary.textContent =
      `${data.axes.length} 根轴 / ${data.stages} 级传动，模数 ${data.module}，` +
      `可啮合装配 ${data.assemblyCount} 种，速比达标 ${data.total} 种`;

    if (!data.feasible) {
      // 区分“无可啮合装配”与“可装配但速比不达标”
      noSolution.className = `alert ${data.reason === 'no-assembly' ? 'warn' : 'error'}`;
      noSolution.textContent = data.message;
      noSolution.hidden = false;
      return;
    }

    bestPanel.hidden = false;
    renderBest(data.best);
  } catch (e) {
    resultPanel.hidden = false;
    bestPanel.hidden = true;
    resultSummary.textContent = '';
    noSolution.hidden = false;
    noSolution.className = 'alert error';
    noSolution.textContent = `请求出错：${e.message}`;
  }
});
