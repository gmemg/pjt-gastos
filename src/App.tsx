import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { AnalyzeResponse, CsvBlock, HistoryItem } from "./types";
import { formatBRL, parseCsvBlock, parseMoney, splitCsvBlocks } from "./utils/csv";

const HISTORY_KEY = "fatura-analyzer-history";
const THEME_KEY = "fatura-analyzer-theme";

function fileListToArray(files: FileList | null): File[] {
  return Array.from(files || []);
}

function supportedFiles(files: File[]): File[] {
  return files.filter((file) => /\.(csv|pdf|ofx|qfx)$/i.test(file.name));
}

function getFriendlyError(data: AnalyzeResponse): string {
  const detailText = data?.details || "";
  let friendly = data?.error || "Falha ao analisar";

  if (detailText.includes("API key was reported as leaked")) {
    friendly = "Sua chave foi marcada como vazada. Gere uma nova chave no Google AI Studio.";
  } else if (detailText.includes("API Key not found")) {
    friendly = "Chave invalida ou ausente. Verifique o .env e reinicie o servidor.";
  } else if (detailText.includes("NOT_FOUND") || detailText.includes("not found")) {
    friendly = "Modelo nao encontrado. Verifique GEMINI_MODEL e GEMINI_FALLBACK_MODEL.";
  }

  return detailText ? `${friendly} | ${detailText}` : friendly;
}

async function readAnalyzeResponse(response: Response): Promise<AnalyzeResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: response.ok
        ? "A API retornou uma resposta vazia."
        : `A API retornou erro ${response.status} sem detalhes.`,
    };
  }

  try {
    return JSON.parse(text) as AnalyzeResponse;
  } catch {
    return {
      error: response.ok
        ? "A API retornou uma resposta invalida."
        : `A API retornou erro ${response.status}.`,
      details: text.slice(0, 500),
    };
  }
}

function readHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as HistoryItem[];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function TablePreview({ title, block }: { title: string; block: CsvBlock }) {
  return (
    <div className="table-block">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            {block.headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}`}>
              {block.headers.map((_, cellIndex) => (
                <td key={`${title}-${rowIndex}-${cellIndex}`}>{row[cellIndex] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function downloadCsv(csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "resultado-faturas.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ThemeIcon({ theme }: { theme: string }) {
  if (theme === "night") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="19"
        height="19"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [csvOutput, setCsvOutput] = useState("");
  const [status, setStatus] = useState("");
  const [modelUsed, setModelUsed] = useState("Modelo: -");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "night");
  const [history, setHistory] = useState<HistoryItem[]>(() => readHistory());
  const [normalized, setNormalized] = useState<AnalyzeResponse["normalized"]>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const blocks = useMemo(() => {
    const parts = splitCsvBlocks(csvOutput);
    return parts.map(parseCsvBlock).filter(Boolean) as CsvBlock[];
  }, [csvOutput]);

  const summary = useMemo(() => {
    const mainBlock = blocks[0];
    if (!mainBlock?.rows.length) return "Resumo: -";

    const lastRow = mainBlock.rows[mainBlock.rows.length - 1];
    const hasTotalRow = lastRow?.[0]?.trim().toUpperCase() === "TOTAL";
    const categories = hasTotalRow ? mainBlock.rows.length - 1 : mainBlock.rows.length;
    const totalFromRows = mainBlock.rows.reduce((sum, row, index) => {
      if (hasTotalRow && index === mainBlock.rows.length - 1) return sum;
      const value = parseMoney(row[2]);
      return value > 0 ? sum + value : sum;
    }, 0);
    const totalFromFooter = hasTotalRow ? parseMoney(lastRow[2]) : 0;
    const total = totalFromFooter > 0 ? totalFromFooter : totalFromRows;

    return `${categories} categorias | Total ${formatBRL(total)}`;
  }, [blocks]);

  const fileNames = files.length
    ? files.map((file) => file.name).join(", ")
    : "Nenhum arquivo selecionado.";

  function updateFiles(nextFiles: File[]) {
    const valid = supportedFiles(nextFiles);
    setFiles(valid);
    setStatus(
      valid.length
        ? `${valid.length} arquivo(s) pronto(s) para analisar.`
        : "Selecione arquivos .csv, .pdf ou .ofx.",
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    updateFiles(fileListToArray(event.target.files));
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    updateFiles(supportedFiles(Array.from(event.dataTransfer.files || [])));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) {
      setStatus("Selecione ao menos um CSV, PDF ou OFX.");
      return;
    }

    setIsLoading(true);
    setStatus("Analisando faturas e conferindo valores...");
    setCsvOutput("");
    setNormalized(undefined);

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await readAnalyzeResponse(response);

      if (!response.ok) {
        throw new Error(getFriendlyError(data));
      }

      const csv = data.csv || "";
      setCsvOutput(csv);
      setModelUsed(
        data.model === "local"
          ? "Modo: analisador local"
          : data.model
          ? `Modelo: ${data.model}${data.fallbackUsed ? " (fallback)" : ""}`
          : "Modelo: -",
      );
      setNormalized(data.normalized);
      setStatus("Pronto.");

      const item: HistoryItem = {
        id: crypto.randomUUID(),
        date: new Date().toLocaleString("pt-BR"),
        files: files.map((file) => file.name),
        csv,
        normalized: data.normalized,
      };
      const nextHistory = [item, ...history].slice(0, 10);
      setHistory(nextHistory);
      saveHistory(nextHistory);
    } catch (error) {
      setStatus(`Erro: ${error instanceof Error ? error.message : String(error)}`);
      setModelUsed("Modelo: -");
    } finally {
      setIsLoading(false);
    }
  }

  function clearAll() {
    setFiles([]);
    setCsvOutput("");
    setStatus("");
    setModelUsed("Modelo: -");
    setNormalized(undefined);
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }

  function useHistory(item: HistoryItem) {
    setCsvOutput(item.csv);
    setNormalized(item.normalized);
    setModelUsed("Modelo: -");
    setStatus(`Carregado do historico de ${item.date}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="page">
      <section className="workspace">
        <div className="intro">
          <p className="eyebrow">React + Vite + TypeScript</p>
          <h1>Analisador de faturas CSV, PDF e OFX</h1>
          <p>
            Envie faturas ou extratos, incluindo Nubank, para gerar um CSV de categorias
            com total e detalhamento.
          </p>
        </div>

        <div className="toolbar">
          <button
            className="icon-button"
            type="button"
            title="Alternar tema"
            aria-label="Alternar tema"
            onClick={() => setTheme(theme === "night" ? "light" : "night")}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Entrada</h2>
            <p className="panel-note">
              CSV, PDF e OFX sao aceitos. O servidor normaliza despesas antes da analise.
            </p>
          </div>
          {normalized ? (
            <span className="pill">
              {normalized.transactions} lancamentos | {normalized.csvTotal}
            </span>
          ) : null}
        </div>

        <form onSubmit={handleSubmit}>
          <label
            className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
          >
            <input type="file" accept=".csv,.pdf,.ofx,.qfx" multiple onChange={handleFileChange} />
            <span className="drop-title">Selecionar ou soltar arquivos</span>
            <span className="drop-subtitle">{fileNames}</span>
          </label>

          <div className="actions">
            <button type="submit" disabled={isLoading || !files.length}>
              {isLoading ? "Analisando..." : "Analisar"}
            </button>
            <button className="ghost" type="button" onClick={clearAll}>
              Limpar
            </button>
          </div>
        </form>

        <div className="status" aria-live="polite">
          {status}
        </div>
      </section>

      {csvOutput ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Resultado</h2>
                <p className="panel-note">{summary}</p>
              </div>
              <div className="result-actions">
                <span className="pill">{modelUsed}</span>
                <button className="ghost" type="button" onClick={() => downloadCsv(csvOutput)}>
                  Baixar CSV
                </button>
              </div>
            </div>

            {normalized?.warnings.length ? (
              <div className="warning">
                {normalized.warnings.join(" ")}
                {normalized.truncated ? " Alguns lancamentos foram truncados." : ""}
              </div>
            ) : null}

            <textarea
              value={csvOutput}
              onChange={(event) => setCsvOutput(event.target.value)}
              rows={12}
              spellCheck={false}
            />
          </section>

          {blocks.length ? (
            <section className="panel">
              <h2>Pre-visualizacao</h2>
              <div className="preview-grid">
                {blocks.map((block, index) => (
                  <TablePreview
                    key={`block-${index}`}
                    title={index === 0 ? "Tabela Principal" : "Detalhamento"}
                    block={block}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Historico local</h2>
            <p className="panel-note">Os ultimos 10 resultados ficam apenas neste navegador.</p>
          </div>
          <button className="ghost" type="button" onClick={clearHistory} disabled={!history.length}>
            Limpar historico
          </button>
        </div>

        <div className="history">
          {history.length ? (
            history.map((item) => (
              <article className="history-item" key={item.id}>
                <div>
                  <strong>{item.date}</strong>
                  <p>{item.files.join(", ")}</p>
                </div>
                <div className="history-actions">
                  <button className="ghost" type="button" onClick={() => useHistory(item)}>
                    Usar
                  </button>
                  <button className="ghost" type="button" onClick={() => downloadCsv(item.csv)}>
                    Baixar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="empty">Sem historico ainda.</p>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
