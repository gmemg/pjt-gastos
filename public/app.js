const form = document.getElementById("uploadForm");
const fileInput = document.getElementById("csvFiles");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("csvOutput");
const previewEl = document.getElementById("preview");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const dropZone = document.getElementById("dropZone");
const themeToggle = document.getElementById("themeToggle");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const modelUsedEl = document.getElementById("modelUsed");
const summaryEl = document.getElementById("summary");

const HISTORY_KEY = "csv-gemini-history";
const THEME_KEY = "csv-gemini-theme";

function setStatus(text) {
  statusEl.textContent = text;
}

function splitCsvBlocks(text) {
  const blocks = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"\"";
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      i += 1;
      continue;
    }

    if (!inQuotes && ch === "\n" && next === "\n") {
      blocks.push(current.trim());
      current = "";
      i += 2;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

function detectDelimiter(sample) {
  let comma = 0;
  let semicolon = 0;
  let inQuotes = false;
  let i = 0;
  while (i < sample.length) {
    const ch = sample[i];
    const next = sample[i + 1];
    if (ch === "\"") {
      if (inQuotes && next === "\"") {
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (!inQuotes) {
      if (ch === ",") comma += 1;
      if (ch === ";") semicolon += 1;
    }
    i += 1;
  }

  if (semicolon === comma) return ";";
  return semicolon > comma ? ";" : ",";
}

function parseCsvBlock(block) {
  if (!block) return null;
  if (!window.Papa) return null;

  const sample = block.split(/\r?\n/).slice(0, 5).join("\n");
  const delimiter = detectDelimiter(sample);
  const parsed = window.Papa.parse(block, {
    skipEmptyLines: true,
    delimiter,
  });

  const rows = parsed.data || [];
  if (rows.length === 0) return null;
  const headers = rows[0].map((h) => String(h).trim());
  const dataRows = rows.slice(1).map((row) => row.map((c) => String(c)));
  return { headers, rows: dataRows };
}

function renderTable(title, block) {
  if (!block) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "table-block";

  const h3 = document.createElement("h3");
  h3.textContent = title;
  wrapper.appendChild(h3);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  block.headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  block.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrapper.appendChild(table);
  return wrapper;
}

function toNumber(value) {
  if (value == null) return 0;
  let v = String(value).trim();
  if (!v) return 0;
  v = v.replace(/[^\d,.\-]/g, "");
  const hasComma = v.includes(",");
  const hasDot = v.includes(".");
  if (hasComma && hasDot) {
    if (v.lastIndexOf(",") > v.lastIndexOf(".")) {
      v = v.replace(/\./g, "").replace(",", ".");
    } else {
      v = v.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    v = v.replace(",", ".");
  }
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function updateSummary(mainBlock) {
  if (!mainBlock || !mainBlock.rows?.length) {
    summaryEl.textContent = "Resumo: —";
    return;
  }

  let total = 0;
  let categories = 0;
  let lastRow = mainBlock.rows[mainBlock.rows.length - 1];
  const lastCategory = lastRow?.[0]?.toString().trim().toUpperCase();
  const hasTotalRow = lastCategory === "TOTAL";

  mainBlock.rows.forEach((row, idx) => {
    if (hasTotalRow && idx === mainBlock.rows.length - 1) return;
    categories += 1;
    total += toNumber(row[2]);
  });

  const totalValue = hasTotalRow ? toNumber(lastRow[2]) : total;
  summaryEl.textContent = `Resumo: ${categories} categorias • Total ${totalValue.toFixed(
    2,
  )}`;
}

function updatePreview(csvText) {
  previewEl.innerHTML = "";

  if (!csvText) {
    summaryEl.textContent = "Resumo: —";
    return;
  }
  const parts = splitCsvBlocks(csvText);
  const mainBlock = parseCsvBlock(parts[0] || "");
  const detailBlock = parseCsvBlock(parts[1] || "");

  const mainTable = renderTable("Tabela Principal", mainBlock);
  if (mainTable) previewEl.appendChild(mainTable);

  if (detailBlock) {
    const detailTable = renderTable("Detalhamento", detailBlock);
    if (detailTable) previewEl.appendChild(detailTable);
  }

  updateSummary(mainBlock);
}

function downloadCsv(csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resultado.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function renderHistory() {
  const items = getHistory();
  historyList.innerHTML = "";
  if (items.length === 0) {
    historyList.textContent = "Sem historico ainda.";
    return;
  }

  items.forEach((item, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${item.date} • ${item.files.join(", ")}`;

    const text = document.createElement("textarea");
    text.rows = 6;
    text.readOnly = true;
    text.value = item.csv;

    const actions = document.createElement("div");
    actions.className = "actions";

    const useBtn = document.createElement("button");
    useBtn.className = "ghost";
    useBtn.type = "button";
    useBtn.textContent = "Usar este resultado";
    useBtn.addEventListener("click", () => {
      outputEl.value = item.csv;
      updatePreview(item.csv);
      downloadBtn.disabled = false;
      modelUsedEl.textContent = "Modelo: —";
      setStatus(`Carregado do historico #${idx + 1}.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.textContent = "Baixar";
    dlBtn.addEventListener("click", () => downloadCsv(item.csv));

    actions.appendChild(useBtn);
    actions.appendChild(dlBtn);

    wrapper.appendChild(meta);
    wrapper.appendChild(text);
    wrapper.appendChild(actions);
    historyList.appendChild(wrapper);
  });
}

function addToHistory(files, csv) {
  const items = getHistory();
  const date = new Date().toLocaleString("pt-BR");
  const names = files.map((f) => f.name);
  items.unshift({ date, files: names, csv });
  saveHistory(items);
  renderHistory();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  themeToggle.setAttribute(
    "aria-label",
    theme === "night" ? "Alternar para tema claro" : "Alternar para tema noturno",
  );
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "light";
  setTheme(saved);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = fileInput.files;
  if (!files || files.length === 0) {
    setStatus("Selecione ao menos um CSV.");
    return;
  }

  setStatus("Analisando com Gemini...");
  outputEl.value = "";
  previewEl.innerHTML = "";
  downloadBtn.disabled = true;

  const formData = new FormData();
  Array.from(files).forEach((f) => formData.append("files", f));

  try {
    const resp = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });

    const data = await resp.json();
    if (!resp.ok) {
      const detailText = data?.details || "";
      let friendly = data?.error || "Falha ao analisar";

      if (detailText.includes("API key was reported as leaked")) {
        friendly =
          "Sua chave foi marcada como vazada. Gere uma nova chave no Google AI Studio.";
      } else if (detailText.includes("API Key not found")) {
        friendly =
          "Chave invalida ou ausente. Verifique o .env e reinicie o servidor.";
      } else if (detailText.includes("NOT_FOUND") || detailText.includes("not found")) {
        friendly =
          "Modelo nao encontrado. Verifique GEMINI_MODEL e GEMINI_FALLBACK_MODEL.";
      }

      const detail = detailText ? ` | ${detailText}` : "";
      throw new Error(friendly + detail);
    }

    outputEl.value = data.csv || "";
    updatePreview(data.csv || "");
    downloadBtn.disabled = false;
    if (data?.model) {
      modelUsedEl.textContent = data.fallbackUsed
        ? `Modelo: ${data.model} (fallback)`
        : `Modelo: ${data.model}`;
    } else {
      modelUsedEl.textContent = "Modelo: —";
    }
    addToHistory(Array.from(files), data.csv || "");
    setStatus("Pronto.");
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
  }
});

downloadBtn.addEventListener("click", () => {
  if (outputEl.value.trim()) {
    downloadCsv(outputEl.value);
  }
});

clearBtn.addEventListener("click", () => {
  fileInput.value = "";
  outputEl.value = "";
  previewEl.innerHTML = "";
  setStatus("");
  downloadBtn.disabled = true;
  modelUsedEl.textContent = "Modelo: —";
  summaryEl.textContent = "Resumo: —";
});

["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone.addEventListener("drop", (e) => {
  const files = Array.from(e.dataTransfer.files || []).filter((f) =>
    f.name.toLowerCase().endsWith(".csv"),
  );
  if (files.length === 0) {
    setStatus("Nenhum CSV valido detectado no drop.");
    return;
  }
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  fileInput.files = dt.files;
  setStatus(`${files.length} arquivo(s) pronto(s) para analisar.`);
});

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "light";
  setTheme(current === "night" ? "light" : "night");
});

clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

loadTheme();
renderHistory();
