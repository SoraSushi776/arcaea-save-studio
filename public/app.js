const $ = (id) => document.getElementById(id);
const state = {
  charts: [],
  records: [],
  summary: null,
  page: 0,
  filter: "",
  pageSize: 100,
  editIndex: -1,
  genRecords: [],
  genSummary: null,
  purchases: [],
  schemaVersion: 4,
};

const DIFF_CLASS = {
  Past: "past", Present: "present", Future: "future", Beyond: "beyond", Eternal: "eternal", Inscribed: "inscribed",
};

/**
 * 弹出轻提示。
 * @param {string} message 文本
 */
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/**
 * 本地计算单曲潜力值。
 * @param {number} score 分数
 * @param {number} constant 定数
 * @param {number} clearType 通关状态
 * @param {number} bonus 奖励
 * @returns {number} 潜力值
 */
function potential(score, constant, clearType, bonus = 0.2) {
  const reward = clearType === 0 ? 0 : bonus;
  if (score >= 10000000) return constant + 2 + reward;
  if (score >= 9800000) return constant + 1 + (score - 9800000) / 200000 + reward;
  return Math.max(0, constant + (score - 9500000) / 300000 + reward);
}

/**
 * 本地计算总 PTT 与 Best50 摘要。
 * @param {any[]} records 成绩
 * @param {number} bonus 奖励
 * @returns {object} 摘要
 */
function summaryOf(records, bonus = 0.2) {
  const rated = records
    .filter((r) => typeof r.constant === "number")
    .map((r) => ({ record: r, potential: potential(r.score, r.constant, r.clearType, bonus) }))
    .sort((a, b) => b.potential - a.potential);
  const b50 = rated.slice(0, 50);
  const b10 = rated.slice(0, 10);
  const b50Sum = b50.reduce((s, x) => s + x.potential, 0);
  const b10Sum = b10.reduce((s, x) => s + x.potential, 0);
  return {
    ptt: (b50Sum + b10Sum) / 60,
    b50Sum,
    b10Sum,
    count: records.length,
    pm: records.filter((r) => r.clearType === 3).length,
    b50,
  };
}

/**
 * 将文件转成 base64。
 * @param {File} file 文件
 * @returns {Promise<string>} base64
 */
async function toBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 切换主面板。
 * @param {number} index 面板序号（0 生成 / 1 编辑 / 2 说明）
 */
function showPanel(index) {
  ["generate", "edit", "about"].forEach((name, i) => {
    $(`panel-${name}`).classList.toggle("hidden", i !== index);
  });
}

/**
 * 触发浏览器下载。
 * @param {Blob} blob 文件内容
 * @param {string} name 文件名
 */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 渲染统计卡。
 */
function renderStats() {
  const summary = state.summary;
  $("ptt-value").textContent = summary ? summary.ptt.toFixed(3) : "--";
  $("stat-count").textContent = summary ? summary.count : 0;
  $("stat-pm").textContent = summary ? summary.pm : 0;
  $("stat-b50").textContent = summary ? summary.b50Sum.toFixed(2) : "0";
  $("stat-b10").textContent = summary ? summary.b10Sum.toFixed(2) : "0";
}

/**
 * 构造筛选后的行数据。
 * @returns {any[]} 行数据
 */
function filteredRows() {
  const records = state.records;
  const keyword = state.filter.trim().toLowerCase();
  const rows = records.map((record) => ({
    record,
    potential: typeof record.constant === "number"
      ? potential(record.score, record.constant, record.clearType)
      : null,
  }));
  const matched = keyword
    ? rows.filter(({ record }) =>
      [record.title, record.artist, record.songId, record.diffName]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(keyword)))
    : rows;
  return matched.sort((a, b) => (b.potential ?? -1) - (a.potential ?? -1));
}

/**
 * 渲染编辑表格。
 */
function renderTable() {
  const rows = filteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages - 1);
  const start = state.page * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const body = $("table-body");
  body.innerHTML = "";
  for (const { record, potential: pot } of pageRows) {
    const tr = document.createElement("tr");
    const diffClass = DIFF_CLASS[record.diffName] || "";
    tr.innerHTML = `
      <td>${escapeHtml(record.title)}</td>
      <td><span class="diff-badge ${diffClass}">${record.diffName}</span></td>
      <td>${record.levelText ?? record.constant ?? "-"}</td>
      <td class="${record.score >= 10000000 ? "score-pm" : ""}">${record.score}</td>
      <td>${record.perfect}</td>
      <td>${record.shiny}</td>
      <td>${record.near}</td>
      <td>${record.miss}</td>
      <td>${pot === null ? "-" : pot.toFixed(3)}</td>
      <td><md-text-button data-edit="${record.songId}|${record.slot}">编辑</md-text-button></td>
    `;
    body.appendChild(tr);
  }
  $("page-label").textContent = `${state.page + 1} / ${totalPages}`;
  if (!rows.length) {
    const hint = document.createElement("tr");
    hint.innerHTML = '<td colspan="10" class="empty-hint">还没有成绩，导入 st3 或去「生成存档」造一份</td>';
    body.appendChild(hint);
  }
}

/**
 * 渲染生成结果表格。
 */
function renderGenTable() {
  const body = $("gen-table-body");
  body.innerHTML = "";
  const rows = [...state.genRecords]
    .map((record) => ({
      record,
      potential: typeof record.constant === "number"
        ? potential(record.score, record.constant, record.clearType)
        : null,
    }))
    .sort((a, b) => (b.potential ?? -1) - (a.potential ?? -1))
    .slice(0, 120);
  for (const { record, potential: pot } of rows) {
    const tr = document.createElement("tr");
    const diffClass = DIFF_CLASS[record.diffName] || "";
    tr.innerHTML = `
      <td>${escapeHtml(record.title)}</td>
      <td><span class="diff-badge ${diffClass}">${record.diffName}</span></td>
      <td>${record.levelText ?? "-"}</td>
      <td class="${record.score >= 10000000 ? "score-pm" : ""}">${record.score}</td>
      <td>${record.perfect}</td>
      <td>${record.shiny}</td>
      <td>${record.near}</td>
      <td>${record.miss}</td>
      <td>${pot === null ? "-" : pot.toFixed(3)}</td>
    `;
    body.appendChild(tr);
  }
  const summary = state.genSummary;
  $("gen-hint").textContent = summary
    ? `PTT ${summary.ptt.toFixed(3)} · ${summary.count} 条 · PM ${summary.pm}`
    : "先生成再看这里";
}

/**
 * 转义 HTML。
 * @param {string} text 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

/**
 * 导入 st3 文件。
 * @param {File} file 文件
 */
async function handleFile(file) {
  $("file-label").textContent = file.name;
  try {
    const db = await toBase64(file);
    const response = await fetch("/api/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "解析失败");
    state.records = data.records;
    state.summary = data.summary;
    state.purchases = data.purchases || [];
    state.schemaVersion = data.schemaVersion || 4;
    state.page = 0;
    $("guide-card").classList.add("hidden");
    $("stats-card").classList.remove("hidden");
    $("edit-content-wrap").classList.remove("hidden");
    renderStats();
    renderTable();
    $("main-tabs").activeTabIndex = 1;
    showPanel(1);
    toast(`已载入 ${data.records.length} 条成绩`);
  } catch (error) {
    toast(error.message);
  }
}

/**
 * 打开编辑对话框。
 * @param {string} key songId|slot
 */
function openEditor(key) {
  const [songId, slotText] = key.split("|");
  const slot = Number(slotText);
  const index = state.records.findIndex((r) => r.songId === songId && r.slot === slot);
  if (index < 0) return;
  const record = state.records[index];
  state.editIndex = index;
  $("edit-title").textContent = `${record.title} · ${record.diffName} · 定数 ${record.constant ?? "?"}`;
  $("edit-score").value = record.score;
  $("edit-pure").value = record.perfect;
  $("edit-shiny").value = record.shiny;
  $("edit-far").value = record.near;
  $("edit-lost").value = record.miss;
  document.querySelectorAll('md-radio[name="clear"]').forEach((radio) => {
    radio.checked = Number(radio.value) === record.clearType;
  });
  $("edit-dialog").show();
  updateEditPotential();
}

/**
 * 刷新编辑对话框里的潜力值提示。
 */
function updateEditPotential() {
  const record = state.records[state.editIndex];
  if (!record || typeof record.constant !== "number") return;
  const score = Number($("edit-score").value) || 0;
  const clearType = Number(document.querySelector('md-radio[name="clear"]:checked')?.value ?? record.clearType);
  $("edit-potential").textContent = `单曲 PTT：${potential(score, record.constant, clearType).toFixed(3)}`;
}

/**
 * 保存编辑内容。
 */
function saveEdit() {
  const record = state.records[state.editIndex];
  if (!record) return;
  record.score = Math.max(0, Math.min(10002000, Number($("edit-score").value) || 0));
  record.perfect = Math.max(0, Number($("edit-pure").value) || 0);
  record.shiny = Math.max(0, Number($("edit-shiny").value) || 0);
  record.near = Math.max(0, Number($("edit-far").value) || 0);
  record.miss = Math.max(0, Number($("edit-lost").value) || 0);
  record.clearType = Number(document.querySelector('md-radio[name="clear"]:checked')?.value ?? record.clearType);
  state.summary = summaryOf(state.records);
  renderStats();
  renderTable();
  $("edit-dialog").close();
  toast("已更新这条成绩");
}

/**
 * 执行生成。
 */
async function generate() {
  const mode = document.querySelector('md-radio[name="mode"]:checked')?.value || "ptt";
  const target = Number($("target-ptt").value) || 0;
  const fill = document.querySelector('md-radio[name="fill"]:checked')?.value || "all";
  const seed = Number($("seed").value) || 20261109;
  const bonus = Number(document.querySelector('md-radio[name="bonus"]:checked')?.value ?? 0.2);
  $("btn-generate").disabled = true;
  $("btn-generate").textContent = "生成中…";
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, target, fill, seed, bonus }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成失败");
    state.genRecords = data.records || [];
    state.genSummary = data.summary;
    renderGenTable();
    toast(`生成完成：PTT ${data.summary.ptt.toFixed(3)}`);
  } catch (error) {
    toast(error.message);
  } finally {
    $("btn-generate").disabled = false;
    $("btn-generate").textContent = "生成";
  }
}

/**
 * 导出当前编辑中的成绩。
 */
async function exportRecords(records, label) {

  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      records: records.map((r) => ({
        songId: r.songId, slot: r.slot, score: r.score, perfect: r.perfect,
        shiny: r.shiny, near: r.near, miss: r.miss, clearType: r.clearType, date: r.date,
      })),
      purchases: state.purchases,
      schemaVersion: state.schemaVersion,
    }),
  });
  if (!response.ok) {
    toast("导出失败");
    return;
  }
  downloadBlob(await response.blob(), label);
  toast(records.length ? "已导出 st3" : "已导出空存档");
}

/**
 * 绑定所有交互。
 */
function bind() {
  $("file-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
    event.target.value = "";
  });
  $("dropzone").addEventListener("click", () => $("file-input").click());
  $("dropzone").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") $("file-input").click();
  });
  const dropzone = $("dropzone");
  ["dragenter", "dragover"].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  }));
  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  $("btn-clear").addEventListener("click", () => {
    state.records = [];
    state.summary = summaryOf([]);
    state.page = 0;
    renderStats();
    renderTable();
    toast("已清空成绩（导出即可得到空存档）");
  });

  $("btn-download").addEventListener("click", () => exportRecords(state.records, "st3"));
  $("fab-download").addEventListener("click", () => exportRecords(state.records, "st3"));

  $("search").addEventListener("input", () => {
    state.filter = $("search").value;
    state.page = 0;
    renderTable();
  });
  $("page-size").addEventListener("input", () => {
    state.pageSize = Math.max(10, Number($("page-size").value) || 100);
    state.page = 0;
    renderTable();
  });
  $("prev-page").addEventListener("click", () => {
    if (state.page > 0) { state.page -= 1; renderTable(); }
  });
  $("next-page").addEventListener("click", () => { state.page += 1; renderTable(); });

  $("table-body").addEventListener("click", (event) => {
    const target = event.target.closest("[data-edit]");
    if (target) openEditor(target.getAttribute("data-edit"));
  });

  $("edit-cancel").addEventListener("click", () => $("edit-dialog").close());
  $("edit-save").addEventListener("click", saveEdit);
  $("edit-score").addEventListener("input", updateEditPotential);
  document.querySelectorAll('md-radio[name="clear"]').forEach((radio) => {
    radio.addEventListener("change", updateEditPotential);
  });

  $("target-slider").addEventListener("input", () => {
    $("target-ptt").value = Number($("target-slider").value).toFixed(2);
  });
  $("target-ptt").addEventListener("input", () => {
    $("target-slider").value = Number($("target-ptt").value) || 0;
  });

  document.querySelectorAll('md-radio[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('md-radio[name="mode"]:checked')?.value;
      $("ptt-controls").classList.toggle("hidden", mode !== "ptt");
    });
  });

  $("btn-generate").addEventListener("click", generate);
  $("btn-adopt").addEventListener("click", () => {
    if (!state.genRecords.length) {
      toast("先生成一份存档");
      return;
    }
    state.records = state.genRecords.map((record) => ({ ...record }));
    state.summary = summaryOf(state.records);
    state.page = 0;
    $("guide-card").classList.add("hidden");
    $("stats-card").classList.remove("hidden");
    $("edit-content-wrap").classList.remove("hidden");
    renderStats();
    renderTable();
    $("main-tabs").activeTabIndex = 1;
    showPanel(1);
    toast("已载入编辑器，可直接改");
  });
  $("btn-gen-download").addEventListener("click", () => exportRecords(state.genRecords, "st3"));

  $("main-tabs").addEventListener("change", () => {
    showPanel(Number($("main-tabs").activeTabIndex) || 0);
  });
  [...document.querySelectorAll("#main-tabs md-primary-tab")].forEach((tab, index) => {
    tab.addEventListener("click", () => showPanel(index));
  });
}

/**
 * 读取深链接参数并切换视图。
 * @param {any} tabs 标签页组件
 */
function applyDeepLink(tabs) {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  const index = { generate: 0, edit: 1, about: 2 }[tab];
  if (index !== undefined && tabs) {
    tabs.activeTabIndex = index;
    showPanel(index);
  }
  if (params.get("demo") === "1") {
    $("target-ptt").value = (params.get("target") || "12.5");
    $("target-slider").value = Number($("target-ptt").value);
    generate().then(() => {
      if (params.get("dialog") === "1" && state.genRecords.length) {
        state.records = state.genRecords.map((record) => ({ ...record }));
        state.summary = summaryOf(state.records);
        renderStats();
        renderTable();
        openEditor(`${state.records[0].songId}|${state.records[0].slot}`);
      }
    });
  }
}

/**
 * 初始化应用。
 */
async function boot() {
  bind();
  const meta = await fetch("/api/meta").then((r) => r.json());
  $("target-slider").max = Math.min(13.9, meta.maxPtt).toFixed(2);
  const catalog = await fetch("/api/catalog").then((r) => r.json());
  state.charts = catalog.charts;
  state.summary = summaryOf([]);
  renderStats();
  renderTable();
  $("main-tabs").activeTabIndex = 0;
  showPanel(0);
  applyDeepLink($("main-tabs"));
}

boot();
