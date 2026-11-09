import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, "..", "data");

const NOTE_KEYS = { 0: "PST", 1: "PRS", 2: "FTR", 3: "BYD", 4: "ETR" };
const SLOT_NAMES = { 0: "Past", 1: "Present", 2: "Future", 3: "Beyond", 4: "Eternal" };
const DIFF_ORDER = { Past: 0, Present: 1, Future: 2, Beyond: 3, Inscribed: 4, Eternal: 5 };

/**
 * 读取 JSON 数据文件。
 * @param {string} name 文件名
 * @param {any} fallback 缺失时的回退值
 * @returns {any} 解析结果
 */
function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * 根据定数与标注等级生成显示用等级文本。
 * @param {number} constant 谱面定数
 * @param {number} rating 游戏内标注等级
 * @returns {string} 例 10 或 10+
 */
export function levelText(constant, rating) {
  if (constant === null || constant === undefined) return String(rating ?? "?");
  const plus = rating >= 8 && constant - Math.floor(constant) >= 0.7 - 1e-9;
  return plus ? `${rating}+` : String(rating);
}

/**
 * 构建曲目与谱面目录。
 * @returns {{songs: any[], charts: any[], chartByKey: Map<string, any>}}
 */
export function loadCatalog() {
  const songlist = readJson("songlist.json", { songs: [] }).songs;
  const constants = readJson("constants.json", { songConstants: {} }).songConstants;
  const chartmeta = readJson("chartmeta.json", { songChartInfo: {} }).songChartInfo;

  const songs = [];
  const charts = [];
  const chartByKey = new Map();

  for (const song of songlist) {
    if (song.deleted) continue;
    const meta = chartmeta[String(song.idx)] || {};
    const notesMap = meta.notes || {};
    const constRow = constants[String(song.idx)] || {};
    const entry = {
      id: song.id,
      title: (song.title_localized && (song.title_localized.zh_Hans || song.title_localized.en)) || song.id,
      titleEn: (song.title_localized && song.title_localized.en) || song.id,
      artist: song.artist || "",
      pack: song.set || "",
      release: song.date || null,
      charts: [],
    };
    for (const diff of song.difficulties || []) {
      const alias = diff.ratingClassAlias === 1;
      const slot = diff.ratingClass;
      const key = alias ? "INS" : NOTE_KEYS[slot];
      const notes = notesMap[key] ?? (alias ? notesMap.BYD : undefined);
      const rating = diff.rating;
      if (!notes || !rating) continue;
      const constant = constRow[key] ?? (alias ? constRow.BYD : null);
      const chart = {
        songId: song.id,
        title: entry.title,
        titleEn: entry.titleEn,
        artist: entry.artist,
        pack: entry.pack,
        slot,
        diffName: alias ? "Inscribed" : SLOT_NAMES[slot],
        level: rating,
        levelText: levelText(constant, rating),
        constant: constant === null || constant === undefined ? null : Number(constant),
        notes,
        release: diff.date || song.date || null,
      };
      entry.charts.push(chart);
      charts.push(chart);
      chartByKey.set(`${song.id}|${slot}`, chart);
    }
    if (entry.charts.length) songs.push(entry);
  }

  charts.sort((a, b) => {
    if (a.songId !== b.songId) return a.songId < b.songId ? -1 : 1;
    return DIFF_ORDER[a.diffName] - DIFF_ORDER[b.diffName];
  });

  return { songs, charts, chartByKey };
}

/**
 * 读取曲目目录上的辅助统计。
 * @returns {{totalCharts: number, totalSongs: number, maxConstant: number}}
 */
export function catalogStats() {
  const { charts, songs } = loadCatalog();
  const maxConstant = charts.reduce((m, c) => Math.max(m, c.constant ?? 0), 0);
  return { totalCharts: charts.length, totalSongs: songs.length, maxConstant };
}
