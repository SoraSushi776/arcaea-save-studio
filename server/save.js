import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(HERE, "..", "node_modules", "sql.js", "dist");

const SQL = await initSqlJs({
  locateFile: (file) => path.join(SQL_DIR, file),
});

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS purchaseentries (id integer primary key autoincrement not null, checksum text, sku text, receipt text, receiptCipheredPayload text);",
  "CREATE TABLE IF NOT EXISTS schemaversion (appliedVersion int unique primary key not null);",
  "CREATE TABLE IF NOT EXISTS scores (id integer primary key autoincrement not null, version int, score int, shinyPerfectCount int, perfectCount int, nearCount int, missCount int, date int, songId text, songDifficulty int, modifier int, health int, ct int default 0);",
  "CREATE TABLE IF NOT EXISTS cleartypes (id integer primary key autoincrement not null, songId text, songDifficulty int, clearType int, ct int default 0);",
];

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/**
 * 安全执行查询，缺表或缺列时返回空结果。
 * @param {any} db 数据库实例
 * @param {string} sql SQL 语句
 * @returns {Array<Array<any>>} 行数据
 */
function trySelect(db, sql) {
  try {
    const result = db.exec(sql);
    return result.length ? result[0].values : [];
  } catch {
    return [];
  }
}

/**
 * 解析上传的 st3 存档。
 * @param {Buffer} buffer 文件内容
 * @returns {{records: any[], purchases: any[], schemaVersion: number}}
 */
export function parseSave(buffer) {
  const db = new SQL.Database(new Uint8Array(buffer));
  const scoreRows = trySelect(
    db,
    "select songId, songDifficulty, score, shinyPerfectCount, perfectCount, nearCount, missCount, date, modifier, health, version from scores",
  );
  const clearRows = trySelect(db, "select songId, songDifficulty, clearType from cleartypes");
  const clearMap = new Map(clearRows.map((row) => [`${row[0]}|${row[1]}`, row[2]]));
  const records = scoreRows.map((row) => ({
    songId: row[0],
    slot: row[1],
    score: row[2],
    shiny: row[3],
    perfect: row[4],
    near: row[5],
    miss: row[6],
    date: row[7],
    modifier: row[8] ?? 0,
    health: row[9] ?? 100,
    version: row[10] ?? 1,
    clearType: clearMap.get(`${row[0]}|${row[1]}`) ?? 0,
  }));
  const purchases = trySelect(db, "select checksum, sku, receipt, receiptCipheredPayload from purchaseentries").map((r) => ({
    checksum: r[0],
    sku: r[1],
    receipt: r[2],
    receiptCipheredPayload: r[3],
  }));
  const versions = trySelect(db, "select appliedVersion from schemaversion");
  const schemaVersion = versions.length ? versions[0][0] : 4;
  db.close();
  return { records, purchases, schemaVersion };
}

/**
 * 由成绩记录构造 st3 数据库字节。
 * @param {Array} records 成绩记录
 * @param {object} options 额外选项（purchases、schemaVersion）
 * @returns {Buffer} st3 文件内容
 */
export function buildSave(records, options = {}) {
  const db = new SQL.Database();
  for (const sql of SCHEMA) db.run(sql);
  db.run("INSERT INTO schemaversion (appliedVersion) VALUES (?)", [options.schemaVersion ?? 4]);
  for (const purchase of options.purchases || []) {
    db.run("INSERT INTO purchaseentries (checksum, sku, receipt, receiptCipheredPayload) VALUES (?, ?, ?, ?)", [
      purchase.checksum ?? null,
      purchase.sku ?? null,
      purchase.receipt ?? null,
      purchase.receiptCipheredPayload ?? null,
    ]);
  }
  const insertScore = db.prepare(
    "INSERT INTO scores (version, score, shinyPerfectCount, perfectCount, nearCount, missCount, date, songId, songDifficulty, modifier, health, ct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertClear = db.prepare(
    "INSERT INTO cleartypes (songId, songDifficulty, clearType, ct) VALUES (?, ?, ?, ?)",
  );
  for (const record of records) {
    const date = Number.isFinite(record.date) ? record.date : NOW_SECONDS();
    insertScore.run([
      record.version ?? 1,
      record.score,
      record.shiny ?? 0,
      record.perfect ?? 0,
      record.near ?? 0,
      record.miss ?? 0,
      date,
      record.songId,
      record.slot,
      record.modifier ?? 0,
      record.health ?? 100,
      0,
    ]);
    insertClear.run([record.songId, record.slot, record.clearType ?? 0, 0]);
  }
  insertScore.free();
  insertClear.free();
  const bytes = db.export();
  db.close();
  return Buffer.from(bytes);
}

/**
 * 计算一个谱面在存档里应写入的附加字段。
 * @param {object} record 成绩记录
 * @param {object} chart 谱面数据
 * @returns {object} 补充后的记录
 */
export function normalizeRecord(record, chart) {
  return {
    songId: record.songId,
    slot: record.slot,
    score: Math.max(0, Math.min(10002000, Math.round(record.score))),
    shiny: Math.max(0, Math.round(record.shiny ?? 0)),
    perfect: Math.max(0, Math.round(record.perfect ?? 0)),
    near: Math.max(0, Math.round(record.near ?? 0)),
    miss: Math.max(0, Math.round(record.miss ?? 0)),
    clearType: Number.isInteger(record.clearType) ? record.clearType : 0,
    date: Number.isFinite(record.date) ? record.date : NOW_SECONDS(),
    modifier: record.modifier ?? 0,
    health: record.health ?? 100,
    notes: chart ? chart.notes : null,
  };
}
