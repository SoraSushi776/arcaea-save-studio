export const CLEAR = { TL: 0, NORMAL: 1, FR: 2, PM: 3, EASY: 4, HARD: 5 };

export const DEFAULT_BONUS = 0.2;

/**
 * 计算单次成绩的单曲潜力值。
 * @param {number} score 分数
 * @param {number} constant 谱面定数
 * @param {number} clearType 通关类型
 * @param {number} bonus 通关奖励系数
 * @returns {number} 单曲潜力值
 */
export function singlePotential(score, constant, clearType, bonus = DEFAULT_BONUS) {
  const reward = clearType === CLEAR.TL ? 0 : bonus;
  if (score >= 10000000) return constant + 2 + reward;
  if (score >= 9800000) return constant + 1 + (score - 9800000) / 200000 + reward;
  return Math.max(0, constant + (score - 9500000) / 300000 + reward);
}

/**
 * 由目标单曲潜力值反推一个自洽的成绩记录。
 * @param {object} chart 谱面数据
 * @param {number} target 目标单曲潜力值
 * @param {number} bonus 通关奖励系数
 * @param {object} opts 生成选项（shinyRate、farLimit）
 * @returns {object} 成绩记录
 */
export function recordForPotential(chart, target, bonus = DEFAULT_BONUS, opts = {}) {
  const constant = chart.constant;
  const notes = chart.notes;
  const shinyRate = opts.shinyRate ?? 0.95;
  const ceiling = constant + 2 + bonus;
  const value = Math.min(target, ceiling);
  if (value >= constant + 2) {
    const shiny = Math.max(0, Math.min(notes, Math.round(notes * shinyRate)));
    return {
      score: 10000000 + shiny,
      perfect: notes,
      shiny,
      near: 0,
      miss: 0,
      clearType: CLEAR.PM,
    };
  }
  const rawScore = value >= constant + 1 + bonus
    ? 9800000 + (value - constant - 1 - bonus) * 200000
    : 9500000 + (value - constant - bonus) * 300000;
  const score = Math.max(0, Math.min(9999999, Math.round(rawScore)));
  return buildCounts(chart, score, shinyRate);
}

/**
 * 由目标分数构造自洽的判定计数。
 * @param {object} chart 谱面数据
 * @param {number} score 目标分数
 * @param {number} shinyRate shiny 占比
 * @returns {object} 成绩记录
 */
export function buildCounts(chart, score, shinyRate = 0.95) {
  const notes = chart.notes;
  if (score >= 10000000) {
    const shiny = Math.max(0, Math.min(notes, Math.round(notes * shinyRate)));
    return { score: 10000000 + shiny, perfect: notes, shiny, near: 0, miss: 0, clearType: CLEAR.PM };
  }
  const lost = score >= 9900000 ? 0 : score >= 9700000 ? Math.round((1 - score / 10000000) * 6) : 0;
  const pureBase = notes - lost;
  const farFloat = (10000000 * (pureBase / notes) + shinyRate * pureBase - score) / (0.5 * 10000000 / notes + shinyRate);
  let far = Math.max(0, Math.min(pureBase, Math.round(farFloat)));
  let counts = assembleCounts(notes, far, lost, shinyRate, score);
  for (let i = 0; i < 24 && counts.score < score; i += 1) {
    far = Math.max(0, far - 1);
    counts = assembleCounts(notes, far, lost, shinyRate, score);
  }
  return counts;
}

/**
 * 组装判定计数并计算分数。
 * @param {number} notes 总物量
 * @param {number} far near 数
 * @param {number} lost 丢失数
 * @param {number} shinyRate shiny 占比
 * @param {number} fallback 兜底分数
 * @returns {object} 成绩记录
 */
function assembleCounts(notes, far, lost, shinyRate, fallback) {
  const pure = Math.max(0, notes - far - lost);
  const shiny = Math.max(0, Math.min(pure, Math.round(pure * shinyRate)));
  const base = pure + 0.5 * far;
  const score = Math.round((10000000 * base) / notes) + shiny;
  return {
    score,
    perfect: pure,
    shiny,
    near: far,
    miss: lost,
    clearType: lost === 0 ? (far === 0 ? CLEAR.PM : CLEAR.FR) : CLEAR.NORMAL,
  };
}

/**
 * 由成绩计算参与排名的单曲潜力值。
 * @param {object} record 成绩记录
 * @param {object} chart 谱面数据
 * @param {number} bonus 通关奖励系数
 * @returns {number} 单曲潜力值
 */
export function recordPotential(record, chart, bonus = DEFAULT_BONUS) {
  return singlePotential(record.score, chart.constant, record.clearType, bonus);
}

/**
 * 计算整体潜力值（Best 50 + Best 10 加权）。
 * @param {Array} records 成绩记录数组
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {number} bonus 通关奖励系数
 * @returns {object} 汇总结果
 */
export function computePTT(records, chartByKey, bonus = DEFAULT_BONUS) {
  const rated = [];
  for (const record of records) {
    const chart = chartByKey.get(`${record.songId}|${record.slot}`);
    if (!chart || chart.constant === null) continue;
    const potential = recordPotential(record, chart, bonus);
    rated.push({ record, chart, potential });
  }
  rated.sort((a, b) => b.potential - a.potential);
  const best50 = rated.slice(0, 50);
  const best10 = rated.slice(0, 10);
  const b50Sum = best50.reduce((sum, item) => sum + item.potential, 0);
  const b10Sum = best10.reduce((sum, item) => sum + item.potential, 0);
  return {
    ptt: (b50Sum + b10Sum) / 60,
    b50Sum,
    b10Sum,
    b50: best50,
    b10: best10,
    ranked: rated,
  };
}

/**
 * 计算理论最高潜力值。
 * @param {Map<string, any>} chartByKey 谱面索引
 * @param {number} bonus 通关奖励系数
 * @returns {number} 理论 PTT 上限
 */
export function theoreticalMax(chartByKey, bonus = DEFAULT_BONUS) {
  const charts = [...chartByKey.values()].filter((c) => c.constant !== null);
  const values = charts.map((c) => c.constant + 2 + bonus).sort((a, b) => b - a);
  const b50 = values.slice(0, 50).reduce((s, v) => s + v, 0);
  const b10 = values.slice(0, 10).reduce((s, v) => s + v, 0);
  return (b50 + b10) / 60;
}
