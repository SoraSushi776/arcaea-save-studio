import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./data.js";
import { DEFAULT_BONUS, computePTT, theoreticalMax, CLEAR } from "./ptt.js";
import { parseSave, buildSave } from "./save.js";
import { generateByPTT, generateTheory, generateEmpty } from "./generator.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "..", "public");
const PORT = Number(process.env.PORT || 3456);

const catalog = loadCatalog();
const maxPtt = theoreticalMax(catalog.chartByKey, DEFAULT_BONUS);

const app = express();
app.use(express.json({ limit: "32mb" }));
app.use(express.static(PUBLIC_DIR));

/**
 * 将成绩记录附加曲目信息。
 * @param {any[]} records 成绩记录
 * @returns {any[]} 带谱面信息的行
 */
function decorate(records) {
  return records.map((record) => {
    const chart = catalog.chartByKey.get(`${record.songId}|${record.slot}`);
    return {
      ...record,
      title: chart ? chart.title : record.songId,
      diffName: chart ? chart.diffName : `slot ${record.slot}`,
      levelText: chart ? chart.levelText : "?",
      constant: chart ? chart.constant : null,
      notes: chart ? chart.notes : null,
    };
  });
}

/**
 * 构造成绩摘要。
 * @param {any[]} records 成绩记录
 * @param {number} bonus 通关奖励系数
 * @returns {object} 摘要
 */
function summarize(records, bonus) {
  const result = computePTT(records, catalog.chartByKey, bonus);
  return {
    ptt: result.ptt,
    b50Sum: result.b50Sum,
    b10Sum: result.b10Sum,
    count: records.length,
    pm: records.filter((r) => r.clearType === CLEAR.PM).length,
    b50: result.b50.map((item) => ({
      songId: item.chart.songId,
      title: item.chart.title,
      diffName: item.chart.diffName,
      levelText: item.chart.levelText,
      constant: item.chart.constant,
      score: item.record.score,
      potential: Number(item.potential.toFixed(3)),
    })),
  };
}

app.get("/api/meta", (req, res) => {
  res.json({
    totalCharts: catalog.charts.length,
    totalSongs: catalog.songs.length,
    maxPtt,
    defaultBonus: DEFAULT_BONUS,
    clearTypes: CLEAR,
  });
});

app.get("/api/catalog", (req, res) => {
  res.json({
    charts: catalog.charts.map((chart) => ({
      songId: chart.songId,
      slot: chart.slot,
      title: chart.title,
      diffName: chart.diffName,
      levelText: chart.levelText,
      constant: chart.constant,
      notes: chart.notes,
    })),
  });
});

app.post("/api/load", (req, res) => {
  try {
    const buffer = Buffer.from(String(req.body.db || ""), "base64");
    if (!buffer.length) return res.status(400).json({ error: "缺少存档数据" });
    const bonus = Number(req.body.bonus ?? DEFAULT_BONUS);
    const parsed = parseSave(buffer);
    const rows = decorate(parsed.records);
    const summary = summarize(parsed.records, bonus);
    res.json({ ...parsed, records: rows, summary });
  } catch (error) {
    res.status(400).json({ error: `存档解析失败：${error.message}` });
  }
});

app.post("/api/summary", (req, res) => {
  const bonus = Number(req.body.bonus ?? DEFAULT_BONUS);
  res.json(summarize(req.body.records || [], bonus));
});

app.post("/api/generate", (req, res) => {
  const bonus = Number(req.body.bonus ?? DEFAULT_BONUS);
  const mode = req.body.mode || "ptt";
  try {
    if (mode === "theory") {
      const records = generateTheory(catalog.chartByKey, { seed: req.body.seed });
      return res.json({ mode, records: decorate(records), summary: summarize(records, bonus) });
    }
    if (mode === "empty") {
      const records = generateEmpty();
      return res.json({ mode, records: [], summary: summarize(records, bonus) });
    }
    const target = Number(req.body.target);
    if (!Number.isFinite(target) || target < 0 || target > maxPtt + 0.001) {
      return res.status(400).json({ error: `目标 PTT 需在 0 ~ ${maxPtt.toFixed(3)} 之间` });
    }
    const result = generateByPTT(catalog.chartByKey, target, {
      bonus,
      seed: Number(req.body.seed ?? 20261109),
      fill: req.body.fill === "b50" ? "b50" : "all",
      spread: Number(req.body.spread ?? 0.55),
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({
      mode,
      target,
      records: decorate(result.records),
      summary: summarize(result.records, bonus),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/export", (req, res) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    const buffer = buildSave(records, {
      purchases: req.body.purchases || [],
      schemaVersion: req.body.schemaVersion ?? 4,
    });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="st3"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Arcaea Save Studio 已启动：http://127.0.0.1:${PORT}`);
  console.log(`谱面 ${catalog.charts.length} 个 / 理论最高 PTT ${maxPtt.toFixed(3)}`);
});
