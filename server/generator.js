import { CLEAR, DEFAULT_BONUS, computePTT, recordForPotential, singlePotential } from "./ptt.js";

/**
 * 创建可复现的伪随机数生成器。
 * @param {number} seed 随机种子
 * @returns {() => number} 生成 [0,1) 的函数
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 在区间内取随机数。
 * @param {() => number} rng 随机源
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number} 随机值
 */
function rand(rng, min, max) {
  return min + (max - min) * rng();
}

/**
 * 计算成绩的游玩时间。
 * @param {() => number} rng 随机源
 * @param {number|null} release 曲目发布时间
 * @param {number} now 当前时间
 * @returns {number} Unix 秒
 */
function playDate(rng, release, now) {
  const start = Math.max(release || 0, 1420070400);
  if (start >= now) return now - Math.round(rand(rng, 3600, 86400 * 7));
  return Math.round(rand(rng, start, now));
}

/**
 * 选出参与 Best 50 的候选谱面。
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {number} target 目标 PTT
 * @returns {any[]} 候选谱面（按定数降序）
 */
function pickCandidates(chartByKey, target) {
  return [...chartByKey.values()]
    .filter((chart) => chart.constant !== null && chart.slot >= 2)
    .filter((chart) => chart.constant + 2 >= target - 0.6)
    .sort((a, b) => b.constant - a.constant)
    .slice(0, 72);
}

/**
 * 生成目标 PTT 的成绩集合。
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {number} target 目标 PTT
 * @param {object} options 生成选项
 * @returns {object} 生成结果
 */
export function generateByPTT(chartByKey, target, options = {}) {
  const bonus = options.bonus ?? DEFAULT_BONUS;
  const seed = options.seed ?? 20261109;
  const spread = options.spread ?? 0.55;
  const fill = options.fill ?? "all";
  const rng = mulberry32(seed);
  const now = Math.floor(Date.now() / 1000);

  const candidates = pickCandidates(chartByKey, target);
  if (candidates.length < 50) {
    return { ok: false, error: "可选谱面不足，无法构造 Best 50" };
  }
  const pool = candidates.slice(0, 50);
  const b10Avg = target + (5 * spread) / 6;
  const restAvg = target - spread / 6;

  const targets = pool.map((chart, index) => {
    const base = index < 10
      ? b10Avg + rand(rng, -0.12, 0.12) - index * 0.01
      : restAvg + 0.3 - ((index - 10) / 39) * (0.3 + 0.5) + rand(rng, -0.06, 0.06);
    const ceiling = chart.constant + 2 + bonus;
    return { chart, value: Math.min(base, ceiling) };
  });

  let records = materialize(targets, bonus, rng, now);
  const result = { ok: true };

  records = calibrate(records, pool, target, bonus, rng, now);

  const ptt = computePTT(records, chartByKey, bonus);
  const filled = fill === "all" ? fillRest(pool, chartByKey, ptt.b50, bonus, rng, now) : [];
  return {
    ...result,
    target,
    ptt: computePTT([...records, ...filled], chartByKey, bonus),
    records: [...records, ...filled],
    charts: [...records, ...filled].length,
  };
}

/**
 * 将目标潜力值实体化为成绩记录。
 * @param {Array<{chart: object, value: number}>} targets 目标值列表
 * @param {number} bonus 通关奖励系数
 * @param {() => number} rng 随机源
 * @param {number} now 当前时间
 * @returns {any[]} 成绩记录
 */
function materialize(targets, bonus, rng, now) {
  return targets.map(({ chart, value }) => {
    const record = recordForPotential(chart, value, bonus, { shinyRate: rand(rng, 0.93, 1.0) });
    return { ...record, songId: chart.songId, slot: chart.slot, date: playDate(rng, chart.release, now) };
  });
}

/**
 * 用二分偏移把整体 PTT 校准到目标值。
 * @param {any[]} records 初始成绩
 * @param {any[]} pool 参与 Best 50 的谱面
 * @param {number} target 目标 PTT
 * @param {number} bonus 通关奖励系数
 * @param {() => number} rng 随机源
 * @param {number} now 当前时间
 * @returns {any[]} 校准后的成绩
 */
function calibrate(records, pool, target, bonus, rng, now) {
  const base = records.map((record, index) => {
    const chart = pool[index];
    return {
      chart,
      record,
      value: singlePotential(record.score, chart.constant, record.clearType, bonus),
    };
  });
  const evaluate = (offset) => {
    const scored = base.map(({ chart, record, value }) => {
      const ceiling = chart.constant + 2 + bonus;
      const next = Math.max(0.2, Math.min(ceiling, value + offset));
      const built = recordForPotential(chart, next, bonus, { shinyRate: 0.95 });
      return { ...built, songId: chart.songId, slot: chart.slot, date: record.date };
    });
    return { scored, total: totalOf(scored, pool, bonus) };
  };
  let low = -20;
  let high = 20;
  let best = evaluate(0);
  if (Math.abs(best.total - target) < 0.0002) return best.scored;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const current = evaluate(mid);
    if (Math.abs(current.total - target) < Math.abs(best.total - target)) best = current;
    if (Math.abs(best.total - target) < 0.00008) break;
    if (current.total < target) low = mid;
    else high = mid;
  }
  return best.scored;
}

/**
 * 计算一组成绩的整体 PTT。
 * @param {any[]} records 成绩记录
 * @param {any[]} pool 对应谱面
 * @param {number} bonus 通关奖励系数
 * @returns {number} PTT
 */
function totalOf(records, pool, bonus) {
  const values = records
    .map((record, index) => singlePotential(record.score, pool[index].constant, record.clearType, bonus))
    .sort((a, b) => b - a);
  const b50 = values.slice(0, 50).reduce((sum, value) => sum + value, 0);
  const b10 = values.slice(0, 10).reduce((sum, value) => sum + value, 0);
  return (b50 + b10) / 60;
}

/**
 * 为 Best 50 之外的谱面填充历史成绩。
 * @param {any[]} pool 已使用的谱面
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {any[]} b50 现有 Best 50
 * @param {number} bonus 通关奖励系数
 * @param {() => number} rng 随机源
 * @param {number} now 当前时间
 * @returns {any[]} 填充成绩
 */
function fillRest(pool, chartByKey, b50, bonus, rng, now) {
  const used = new Set(pool.map((chart) => `${chart.songId}|${chart.slot}`));
  const floor = b50.length ? b50[b50.length - 1].potential : 8;
  const others = [...chartByKey.values()].filter(
    (chart) => chart.constant !== null && !used.has(`${chart.songId}|${chart.slot}`),
  );
  return others.map((chart) => {
    const ceiling = chart.constant + 2 + bonus;
    const top = Math.min(ceiling, floor * rand(rng, 0.92, 0.985));
    const low = Math.min(top, Math.max(0.3, floor * rand(rng, 0.35, 0.8)));
    const value = rand(rng, low, top);
    const record = recordForPotential(chart, value, bonus, { shinyRate: rand(rng, 0.85, 0.98) });
    return { ...record, songId: chart.songId, slot: chart.slot, date: playDate(rng, chart.release, now) };
  });
}

/**
 * 生成全理论成绩集。
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {object} options 生成选项
 * @returns {any[]} 成绩记录
 */
export function generateTheory(chartByKey, options = {}) {
  const rng = mulberry32(options.seed ?? 7);
  const now = Math.floor(Date.now() / 1000);
  return [...chartByKey.values()]
    .filter((chart) => chart.constant !== null)
    .map((chart) => ({
      songId: chart.songId,
      slot: chart.slot,
      score: 10000000 + chart.notes,
      perfect: chart.notes,
      shiny: chart.notes,
      near: 0,
      miss: 0,
      clearType: CLEAR.PM,
      date: playDate(rng, chart.release, now),
      modifier: 0,
      health: 100,
    }));
}

/**
 * 生成空存档成绩集。
 * @returns {any[]} 空数组
 */
export function generateEmpty() {
  return [];
}
