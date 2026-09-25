'use strict';

/**
 * 轴位装配算法
 *
 * 场景：2～4 根轴沿直线依次排列（轴心坐标为整数），相邻两轴之间各安装一级齿轮传动；
 * 中间轴上同轴固定前一级的从动轮与后一级的主动轮（复合轮系），
 * 动力沿 轴1 → 轴2 → … → 轴N 依次传递。
 *
 * 约束：
 *   - 每级啮合须满足 2×轴距 = 模数 × (主动齿数 + 从动齿数)（标准齿轮中心距公式）；
 *   - 每枚实物齿轮全程至多使用一次；
 *   - 总速比 = ∏(主动齿数 / 从动齿数)，以精确分数（BigInt）校核相对误差 ≤ 容差。
 *
 * 枚举：先对每级求出满足轴距的全部有向配对，再按级深搜组合（齿轮不复用），
 * 统计可啮合装配总数与速比达标方案总数；达标方案中按
 * “相对误差最小 → 各级 (主动,从动) 齿轮编号自然序” 选出唯一最佳方案。
 *
 * 无解时区分：
 *   - no-assembly：无可啮合装配（某级没有任何满足轴距的配对，
 *     或各级配对无法在不复用齿轮的前提下同时装齐）；
 *   - ratio：存在可啮合装配，但全部实际总速比超出容差。
 */

const { makeFrac } = require('./search');

/** 轴数范围 / 模数上限 / 轴心坐标绝对值上限 */
const MIN_AXES = 2;
const MAX_AXES = 4;
const MAX_MODULE = 1_000_000;
const MAX_COORD = 1_000_000_000;

/**
 * 解析整数：接受 JSON number 或纯数字字符串（可带符号），拒绝科学计数法与小数。
 */
function parseIntRaw(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
    return raw;
  }
  if (typeof raw === 'string' && /^[+-]?\d+$/.test(raw.trim())) {
    const v = Number(raw.trim());
    if (Number.isSafeInteger(v)) return v;
  }
  return null;
}

/**
 * 校验轴心坐标：2～4 个整数（|x| ≤ MAX_COORD），沿直线依次排列。
 * 相邻坐标之差（取绝对值）即该级轴距；相邻坐标重合时该级轴距为 0，
 * 自然导致“无可啮合装配”，不在此处拒绝。
 *
 * @returns {{ok:true,axes:number[]}|{ok:false,error:string}}
 */
function parseAxes(input) {
  if (!Array.isArray(input) || input.length < MIN_AXES || input.length > MAX_AXES) {
    return { ok: false, error: `需输入 ${MIN_AXES}～${MAX_AXES} 个沿直线依次排列的轴心整数坐标` };
  }
  const axes = [];
  for (let i = 0; i < input.length; i++) {
    const v = parseIntRaw(input[i]);
    if (v === null || Math.abs(v) > MAX_COORD) {
      return { ok: false, error: `第 ${i + 1} 个轴心坐标需为 -${MAX_COORD}～${MAX_COORD} 的整数` };
    }
    axes.push(v);
  }
  return { ok: true, axes };
}

/**
 * 校验模数：正整数（1～MAX_MODULE）。
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
function parseModule(raw) {
  const hint = `模数需为 1～${MAX_MODULE} 的正整数`;
  const v = parseIntRaw(raw);
  if (v === null || v < 1 || v > MAX_MODULE) return { ok: false, error: hint };
  return { ok: true, value: v };
}

/**
 * 轴位装配主入口。
 *
 * @param {Array<{id:string,teeth:number}>} gears 规范化齿轮（2～12 枚，按编号自然序）
 * @param {number[]} axes 轴心坐标（2～4 个整数，沿传动链依次排列）
 * @param {number} module 正整数模数
 * @param {{num:bigint,den:bigint}} target 目标输出转速比（正分数）
 * @param {{num:bigint,den:bigint}} tolerance 允许相对误差（非负分数）
 * @returns {object} 见 README 与 /api/layout 返回结构
 */
function planLayout(gears, axes, module, target, tolerance) {
  const n = gears.length;
  const teeth = gears.map((g) => BigInt(g.teeth));
  const m = BigInt(module);
  const stageCount = axes.length - 1;

  // 每级：轴距、所需齿数和（2×轴距能被模数整除且 ≥2 时才有解）、满足轴距的有向配对
  const distances = [];
  const teethSums = []; // number | null（null 表示 2×轴距不能被模数整除或齿数和 < 2）
  const pairLists = [];
  for (let i = 0; i < stageCount; i++) {
    const d = Math.abs(axes[i + 1] - axes[i]);
    distances.push(d);
    let sum = null;
    const pairs = [];
    const twice = 2n * BigInt(d);
    if (twice % m === 0n) {
      const s = twice / m;
      if (s >= 2n) {
        sum = Number(s);
        for (let a = 0; a < n; a++) {
          for (let b = 0; b < n; b++) {
            if (b === a) continue;
            if (teeth[a] + teeth[b] === s) pairs.push({ driveIndex: a, drivenIndex: b });
          }
        }
      }
    }
    teethSums.push(sum);
    pairLists.push(pairs);
  }
  const stagePairCounts = pairLists.map((l) => l.length);

  // 按级深搜：每级选一个满足轴距的有向配对，每枚齿轮全程至多使用一次
  let assemblyCount = 0; // 可啮合装配总数（不考虑速比）
  let total = 0; // 速比达标方案总数
  let best = null; // 当前最优达标方案（轻量：下标 + 分数）

  const used = new Array(n).fill(false);
  const picks = new Array(stageCount);

  /** 达标方案择优：相对误差最小 → 各级 (主动,从动) 编号自然序（下标序即编号自然序） */
  function cmpBest(x, y) {
    const le = x.errNum * y.errDen;
    const re = y.errNum * x.errDen;
    if (le !== re) return le < re ? -1 : 1;
    for (let i = 0; i < x.picks.length; i++) {
      if (x.picks[i].driveIndex !== y.picks[i].driveIndex) {
        return x.picks[i].driveIndex - y.picks[i].driveIndex;
      }
      if (x.picks[i].drivenIndex !== y.picks[i].drivenIndex) {
        return x.picks[i].drivenIndex - y.picks[i].drivenIndex;
      }
    }
    return 0;
  }

  function dfs(stage) {
    if (stage === stageCount) {
      assemblyCount += 1;
      // 总速比 = ∏(主动齿/从动齿)，未约分整数累计，达标判定走整数乘法不等式
      let rn = 1n;
      let rd = 1n;
      for (const p of picks) {
        rn *= teeth[p.driveIndex];
        rd *= teeth[p.drivenIndex];
      }
      const lhs = rn * target.den - target.num * rd;
      const abs = lhs < 0n ? -lhs : lhs;
      if (abs * tolerance.den > tolerance.num * target.num * rd) return;
      total += 1;
      const error = makeFrac(abs, rd * target.num);
      const cand = {
        errNum: error.num,
        errDen: error.den,
        ratio: makeFrac(rn, rd),
        error,
        picks: picks.slice(),
      };
      if (!best || cmpBest(cand, best) < 0) best = cand;
      return;
    }
    for (const p of pairLists[stage]) {
      if (used[p.driveIndex] || used[p.drivenIndex]) continue;
      used[p.driveIndex] = true;
      used[p.drivenIndex] = true;
      picks[stage] = p;
      dfs(stage + 1);
      used[p.driveIndex] = false;
      used[p.drivenIndex] = false;
    }
  }

  // 某一级完全没有可啮合配对时不可能有任何装配，直接跳过深搜
  if (pairLists.every((l) => l.length > 0)) dfs(0);

  const result = {
    stages: stageCount,
    distances,
    teethSums,
    stagePairCounts,
    assemblyCount,
    total,
    best: null,
  };
  if (!best) return result;

  // 展开最佳方案：逐级传动明细
  const stageDetails = best.picks.map((p, i) => ({
    stage: i + 1,
    fromAxis: i + 1,
    toAxis: i + 2,
    fromPosition: axes[i],
    toPosition: axes[i + 1],
    distance: distances[i],
    teethSum: teethSums[i],
    drive: { id: gears[p.driveIndex].id, teeth: gears[p.driveIndex].teeth },
    driven: { id: gears[p.drivenIndex].id, teeth: gears[p.drivenIndex].teeth },
    stageRatio: makeFrac(teeth[p.driveIndex], teeth[p.drivenIndex]),
  }));

  // 逐轴安装明细：首轴只装第 1 级主动轮，末轴只装末级从动轮，
  // 中间轴同轴固定前级从动轮与后级主动轮
  const axisDetails = axes.map((pos, i) => ({ axis: i + 1, position: pos, gears: [] }));
  best.picks.forEach((p, i) => {
    axisDetails[i].gears.push({
      id: gears[p.driveIndex].id,
      teeth: gears[p.driveIndex].teeth,
      role: 'drive',
      stage: i + 1,
    });
    axisDetails[i + 1].gears.push({
      id: gears[p.drivenIndex].id,
      teeth: gears[p.drivenIndex].teeth,
      role: 'driven',
      stage: i + 1,
    });
  });

  result.best = {
    ratio: best.ratio,
    error: best.error,
    stages: stageDetails,
    axes: axisDetails,
  };
  return result;
}

module.exports = {
  MIN_AXES,
  MAX_AXES,
  MAX_MODULE,
  MAX_COORD,
  parseAxes,
  parseModule,
  planLayout,
};
