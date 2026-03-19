const form = document.getElementById("uploadForm");
const fileInput = document.getElementById("csvFiles");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("csvOutput");
const previewEl = document.getElementById("preview");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");

function setStatus(text) {
  statusEl.textContent = text;
}

function parseCsvBlock(block) {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return cols;
  });

  return { headers, rows };
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

function updatePreview(csvText) {
  previewEl.innerHTML = "";

  if (!csvText) return;
  const parts = csvText.split(/\r?\n\s*\r?\n/);
  const mainBlock = parseCsvBlock(parts[0] || "");
  const detailBlock = parseCsvBlock(parts[1] || "");

  const mainTable = renderTable("Tabela Principal", mainBlock);
  if (mainTable) previewEl.appendChild(mainTable);

  if (detailBlock) {
    const detailTable = renderTable("Detalhamento", detailBlock);
    if (detailTable) previewEl.appendChild(detailTable);
  }
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
      throw new Error(data?.error || "Falha ao analisar");
    }

    outputEl.value = data.csv || "";
    updatePreview(data.csv || "");
    downloadBtn.disabled = false;
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
});
