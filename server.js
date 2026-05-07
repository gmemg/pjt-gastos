import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import Papa from "papaparse";
import { PDFParse } from "pdf-parse";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 12,
  },
});
const uploadFiles = upload.array("files");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const USE_GEMINI =
  process.env.USE_GEMINI === "true" &&
  Boolean(GEMINI_API_KEY) &&
  GEMINI_API_KEY !== "COLE_SUA_CHAVE_AQUI";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-pro";
const MAX_NORMALIZED_ROWS = Number.parseInt(
  process.env.MAX_NORMALIZED_ROWS || "2500",
  10,
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
} else {
  app.use(express.static("public"));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const removeAccents = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeKey = (value) =>
  removeAccents(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const decodeText = (buffer) => {
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const badChars = (utf8.match(/\uFFFD/g) || []).length;
  if (badChars > 3) return buffer.toString("latin1").replace(/^\uFEFF/, "");
  return utf8;
};

const detectDelimiter = (sample) => {
  const firstLines = sample.split(/\r?\n/).slice(0, 8).join("\n");
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;

  for (let i = 0; i < firstLines.length; i += 1) {
    const ch = firstLines[i];
    const next = firstLines[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch in counts) counts[ch] += 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

const parseAmount = (value) => {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw) return null;

  const isParenthesized = /^\(.*\)$/.test(raw);
  raw = raw.replace(/[^\d,.\-()]/g, "");
  raw = raw.replace(/[()]/g, "");
  if (!raw || raw === "-") return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    raw =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  return isParenthesized ? -Math.abs(parsed) : parsed;
};

const toCents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (value) => (Number(value) || 0) / 100;

const formatNumber = (value) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatBRL = (value) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const runUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadFiles(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const expenseWords = [
  "compra",
  "pix enviado",
  "transferencia enviada",
  "boleto pago",
  "pagamento efetuado",
  "debito",
  "saque",
  "tarifa",
  "iof",
  "assinatura",
];

const creditWords = [
  "pagamento recebido",
  "pagamento de fatura",
  "pagamento da fatura",
  "estorno",
  "credito",
  "cashback",
  "reembolso",
  "salario",
  "pix recebido",
  "transferencia recebida",
  "deposito",
  "rendimento",
  "resgate",
  "entrada",
  "recebido",
  "refund",
];

const categoryRules = [
  {
    category: "Alimentacao",
    words: [
      "restaurante",
      "ifood",
      "mercado",
      "supermercado",
      "padaria",
      "lanche",
      "pizza",
      "burger",
      "coffee",
      "cafe",
      "bar ",
      "hortifruti",
      "acougue",
    ],
  },
  {
    category: "Transporte",
    words: [
      "uber",
      "99",
      "posto",
      "combustivel",
      "gasolina",
      "estacionamento",
      "pedagio",
      "metro",
      "onibus",
      "transporte",
    ],
  },
  {
    category: "Moradia",
    words: [
      "aluguel",
      "condominio",
      "energia",
      "luz",
      "agua",
      "gas",
      "internet",
      "vivo",
      "claro",
      "tim",
      "net ",
    ],
  },
  {
    category: "Saude",
    words: [
      "farmacia",
      "drogaria",
      "hospital",
      "clinica",
      "medico",
      "laboratorio",
      "exame",
      "saude",
    ],
  },
  {
    category: "Compras",
    words: [
      "amazon",
      "mercado livre",
      "magazine",
      "loja",
      "shopping",
      "roupa",
      "calcados",
      "shein",
      "shopee",
    ],
  },
  {
    category: "Servicos Digitais",
    words: [
      "netflix",
      "spotify",
      "google",
      "apple",
      "microsoft",
      "openai",
      "github",
      "assinatura",
      "streaming",
    ],
  },
  {
    category: "Educacao",
    words: ["curso", "faculdade", "escola", "livraria", "udemy", "educacao"],
  },
  {
    category: "Lazer",
    words: ["cinema", "ingresso", "hotel", "viagem", "airbnb", "show", "teatro"],
  },
  {
    category: "Taxas e Tarifas",
    words: ["tarifa", "juros", "iof", "multa", "anuidade"],
  },
];

const findColumn = (headers, candidates) => {
  const normalized = headers.map((h) => ({ original: h, key: normalizeKey(h) }));
  return (
    normalized.find(({ key }) => candidates.some((candidate) => key === candidate))
      ?.original ||
    normalized.find(({ key }) =>
      candidates.some((candidate) => key.includes(candidate)),
    )?.original
  );
};

const rowText = (row) => Object.values(row).filter(Boolean).join(" ");

const parseOfxDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return raw.slice(0, 10);
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const parseCsvExpenses = (file) => {
  const text = decodeText(file.buffer);
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse(text, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (header) => String(header || "").trim(),
  });

  const rows = parsed.data.filter((row) =>
    Object.values(row).some((value) => String(value || "").trim()),
  );
  const headers = parsed.meta.fields || Object.keys(rows[0] || {});
  const amountColumn = findColumn(headers, [
    "amount",
    "valor",
    "valor r",
    "valor brl",
    "valor da compra",
    "valor original",
    "preco",
    "total",
  ]);
  const descriptionColumn = findColumn(headers, [
    "title",
    "descricao",
    "descrição",
    "estabelecimento",
    "historico",
    "lançamento",
    "lancamento",
    "nome",
    "detalhes",
  ]);
  const dateColumn = findColumn(headers, ["date", "data", "posted date"]);

  if (!amountColumn) {
    return {
      file: file.originalname,
      rows: [],
      warnings: [`Nao encontrei coluna de valor em ${file.originalname}.`],
    };
  }

  const fileHint = normalizeKey(file.originalname);
  const isLikelyCreditCard =
    fileHint.includes("fatura") ||
    fileHint.includes("cartao") ||
    fileHint.includes("invoice") ||
    fileHint.includes("nubank") ||
    headers.map(normalizeKey).includes("title");

  const expenses = [];
  const warnings = [];

  rows.forEach((row, index) => {
    const amount = parseAmount(row[amountColumn]);
    if (!amount) return;

    const description =
      String(row[descriptionColumn] || "").trim() ||
      rowText(row).slice(0, 120) ||
      `Lancamento ${index + 1}`;
    const normalizedDescription = normalizeKey(description);
    const fullText = normalizeKey(rowText(row));
    const hasCreditWord = creditWords.some((word) => fullText.includes(word));
    const hasExpenseWord = expenseWords.some((word) => fullText.includes(word));

    if (hasCreditWord && !hasExpenseWord) return;
    if (amount > 0 && !isLikelyCreditCard && !hasExpenseWord) return;

    expenses.push({
      date: String(row[dateColumn] || "").trim(),
      description,
      amount: Math.abs(amount),
      source: file.originalname,
      originalSign: amount < 0 ? "negativo" : "positivo",
      hint: normalizedDescription.includes("nubank") ? "nubank" : "",
    });
  });

  if (parsed.errors?.length) {
    warnings.push(
      `${file.originalname}: ${parsed.errors.length} linha(s) com alerta de leitura.`,
    );
  }

  return { file: file.originalname, rows: expenses, warnings };
};

const parseOfxExpenses = (file) => {
  const warnings = [];
  const text = decodeText(file.buffer);
  const entries = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  if (!entries.length) {
    return {
      file: file.originalname,
      rows: [],
      warnings: [`${file.originalname}: nao encontrei transacoes STMTTRN no OFX.`],
    };
  }

  const readTag = (chunk, tag) => {
    const full = chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (full) return String(full[1] || "").trim();
    const inline = chunk.match(new RegExp(`<${tag}>([^\\r\\n<]+)`, "i"));
    return inline ? String(inline[1] || "").trim() : "";
  };

  const rows = entries.flatMap(([, chunk], index) => {
    const trnamtText = readTag(chunk, "TRNAMT");
    const amount = parseAmount(trnamtText);
    if (!amount) return [];

    const type = normalizeKey(readTag(chunk, "TRNTYPE"));
    const memo = readTag(chunk, "MEMO");
    const name = readTag(chunk, "NAME");
    const fitid = readTag(chunk, "FITID");
    const date = parseOfxDate(readTag(chunk, "DTPOSTED"));
    const description = [memo, name].filter(Boolean).join(" - ") || `Transacao ${index + 1}`;
    const fullText = normalizeKey(`${type} ${description}`);
    const hasCreditWord = creditWords.some((word) => fullText.includes(word));
    const hasExpenseWord = expenseWords.some((word) => fullText.includes(word));
    const isCreditType = ["credit", "dep", "int", "xfer"].includes(type);
    const isDebitType = ["debit", "pos", "atm", "fee", "check", "payment"].includes(type);

    if (hasCreditWord && !hasExpenseWord) return [];
    if (isCreditType && !hasExpenseWord) return [];
    if (amount > 0 && !isDebitType && !hasExpenseWord) return [];

    return [
      {
        date,
        description,
        amount: Math.abs(amount),
        source: file.originalname,
        originalSign: amount < 0 ? "negativo" : "positivo",
        hint: `ofx:${fitid || "sem-id"}`,
      },
    ];
  });

  if (!rows.length) {
    warnings.push(
      `${file.originalname}: transacoes detectadas, mas nenhuma despesa valida apos filtros.`,
    );
  }

  return { file: file.originalname, rows, warnings };
};

const toNormalizedCsv = (transactions) => {
  const rows = [
    ['"Arquivo"', '"Data"', '"Descricao"', '"Valor"', '"SinalOriginal"'].join(";"),
    ...transactions.map((tx) =>
      [
        tx.source,
        tx.date,
        tx.description,
        formatNumber(tx.amount),
        tx.originalSign,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(";"),
    ),
  ];
  return rows.join("\n");
};

const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const categoryFor = (description) => {
  const text = normalizeKey(description);
  const rule = categoryRules.find(({ words }) =>
    words.some((word) => text.includes(normalizeKey(word))),
  );
  return rule?.category || "Outros";
};

const merchantFor = (description) =>
  String(description || "")
    .replace(/\s+/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "")
    .replace(/\b\d{4,}\b/g, "")
    .trim()
    .slice(0, 80) || "Lancamento";

const buildLocalCsv = (transactions) => {
  const byCategory = new Map();
  const byCategoryMerchant = new Map();

  transactions.forEach((tx) => {
    const category = categoryFor(tx.description);
    const merchant = merchantFor(tx.description);
    byCategory.set(category, (byCategory.get(category) || 0) + toCents(tx.amount));

    if (!byCategoryMerchant.has(category)) byCategoryMerchant.set(category, new Map());
    const merchantMap = byCategoryMerchant.get(category);
    merchantMap.set(merchant, (merchantMap.get(merchant) || 0) + toCents(tx.amount));
  });

  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const total = categories.reduce((sum, [, value]) => sum + value, 0);

  const mainRows = [
    ["Categoria", "Descricao", "Valor"],
    ...categories.map(([category, value]) => [
      category,
      `Total em ${category}`,
      formatBRL(fromCents(value)),
    ]),
    ["TOTAL", "Total geral", formatBRL(fromCents(total))],
  ];

  const topCategories = categories.slice(0, 3);
  const detailRows = [["Categoria", "Descricao", "Valor"]];
  topCategories.forEach(([category]) => {
    const merchants = [...(byCategoryMerchant.get(category) || new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    merchants.forEach(([merchant, value]) => {
      detailRows.push([category, merchant, formatBRL(fromCents(value))]);
    });
  });

  const stringify = (rows) =>
    rows.map((row) => row.map(escapeCsv).join(";")).join("\n");

  return `${stringify(mainRows)}\n\n${stringify(detailRows)}`;
};

const parsePdfExpenses = async (file) => {
  const warnings = [];
  try {
    const parser = new PDFParse({ data: file.buffer });
    const parsed = await parser.getText();
    const text = String(parsed.text || "");
    await parser.destroy();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const expenses = [];
    const amountPattern =
      /(?:R\$\s*)?(\(?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?|\(?-?\d+,\d{2}\)?)/g;

    lines.forEach((line, index) => {
      const normalizedLine = normalizeKey(line);
      const hasCreditWord = creditWords.some((word) => normalizedLine.includes(word));
      const looksLikeSummary =
        normalizedLine.includes("total") ||
        normalizedLine.includes("limite") ||
        normalizedLine.includes("vencimento") ||
        normalizedLine.includes("saldo") ||
        normalizedLine.includes("fechamento");

      if (hasCreditWord || looksLikeSummary) return;

      const matches = [...line.matchAll(amountPattern)];
      if (!matches.length) return;

      const amount = parseAmount(matches[matches.length - 1][1]);
      if (!amount) return;

      const description = line
        .replace(matches[matches.length - 1][0], "")
        .replace(/\s+/g, " ")
        .trim();

      if (!description || description.length < 3) return;

      expenses.push({
        date: "",
        description,
        amount: Math.abs(amount),
        source: file.originalname,
        originalSign: amount < 0 ? "negativo" : "positivo",
        hint: "pdf-local",
      });
    });

    warnings.push(
      `${file.originalname}: PDF analisado localmente; confira o total, pois o layout do banco pode variar.`,
    );

    return { file: file.originalname, rows: expenses, warnings };
  } catch (err) {
    return {
      file: file.originalname,
      rows: [],
      warnings: [
        `${file.originalname}: nao foi possivel extrair texto do PDF localmente (${String(
          err,
        )}).`,
      ],
    };
  }
};

const buildPrompt = ({ normalizedCsv, total, pdfNames, warnings, truncated }) => {
  const pdfInstruction = pdfNames.length
    ? `\nArquivos PDF anexados: ${pdfNames.join(", ")}.\nPara PDFs de fatura, leia os lancamentos da fatura, ignore pagamento da fatura, estornos, creditos, reembolsos e entradas. Some despesas usando o valor absoluto apenas uma vez por lancamento.`
    : "";

  const csvInstruction = normalizedCsv
    ? `\nCSV normalizado pelo servidor, ja filtrado para despesas provaveis. Use estes valores como fonte de verdade para calculos de CSV. O total normalizado dos CSVs e ${formatBRL(total)} e a linha TOTAL final deve bater com esse valor quando nao houver PDF adicional.\n\n${normalizedCsv}`
    : "\nNao houve CSV normalizado com despesas detectadas.";

  return `Gere uma resposta APENAS em CSV com 3 colunas:
"Categoria";"Descricao";"Valor"

Regras obrigatorias:
- Use ponto e virgula (;) como delimitador e aspas duplas em todos os campos.
- Categorize despesas por tipo de gasto.
- Ignore receitas, entradas, pagamentos de fatura, estornos, creditos, cashback e reembolsos.
- Em faturas Nubank, compras podem vir com sinal positivo ou negativo; despesa deve ser considerada pelo valor absoluto, sem duplicar.
- Some valores com precisao de centavos. Nao invente valores.
- Ordene categorias por Valor desc.
- Inclua uma linha TOTAL no primeiro bloco.
- Valor deve estar em BRL no formato "R$ 1.234,56".

Detalhamento:
- Depois de uma linha em branco, gere um segundo bloco CSV com as mesmas 3 colunas.
- Detalhe as 3 categorias de maior gasto com os principais estabelecimentos/itens.

${warnings.length ? `Alertas de leitura: ${warnings.join(" | ")}` : ""}
${truncated ? "Observacao: alguns lancamentos de CSV foram truncados por limite de volume." : ""}
${pdfInstruction}
${csvInstruction}`;
};

app.post("/api/analyze", async (req, res) => {
  try {
    await runUpload(req, res);

    const files = req.files || [];
    if (files.length === 0) {
      return res
        .status(400)
        .json({ error: "Envie ao menos um arquivo CSV, PDF ou OFX." });
    }

    const csvFiles = files.filter((file) =>
      /(^text\/csv$|csv|plain|excel|spreadsheet)/i.test(file.mimetype) ||
      file.originalname.toLowerCase().endsWith(".csv"),
    );
    const pdfFiles = files.filter(
      (file) =>
        file.mimetype === "application/pdf" ||
        file.originalname.toLowerCase().endsWith(".pdf"),
    );
    const ofxFiles = files.filter(
      (file) =>
        /ofx|qfx|octet-stream|plain/i.test(file.mimetype) ||
        file.originalname.toLowerCase().endsWith(".ofx") ||
        file.originalname.toLowerCase().endsWith(".qfx"),
    );

    if (csvFiles.length + pdfFiles.length + ofxFiles.length !== files.length) {
      return res.status(400).json({
        error: "Formato nao suportado. Envie apenas arquivos .csv, .pdf ou .ofx.",
      });
    }

    const parsedCsv = csvFiles.map(parseCsvExpenses);
    const parsedOfx = ofxFiles.map(parseOfxExpenses);
    const parsedPdf = USE_GEMINI
      ? []
      : await Promise.all(pdfFiles.map(parsePdfExpenses));
    const warnings = [...parsedCsv, ...parsedOfx, ...parsedPdf].flatMap(
      (item) => item.warnings,
    );
    let transactions = [...parsedCsv, ...parsedOfx, ...parsedPdf].flatMap(
      (item) => item.rows,
    );
    let truncated = false;

    if (transactions.length > MAX_NORMALIZED_ROWS) {
      transactions = transactions.slice(0, MAX_NORMALIZED_ROWS);
      truncated = true;
    }

    const totalCents = transactions.reduce((sum, tx) => sum + toCents(tx.amount), 0);
    const total = fromCents(totalCents);
    const normalizedCsv = transactions.length ? toNormalizedCsv(transactions) : "";

    if (!USE_GEMINI) {
      if (!transactions.length) {
        return res.status(422).json({
          error:
            "Nao encontrei lancamentos de despesa para analisar localmente.",
          details:
            "Sem chave de API, PDFs escaneados/imagem, OFX invalido ou CSVs com colunas desconhecidas podem nao ser lidos.",
          normalized: {
            files: csvFiles.length + ofxFiles.length,
            pdfs: pdfFiles.length,
            transactions: 0,
            csvTotal: formatBRL(0),
            warnings,
            truncated,
          },
        });
      }

      return res.json({
        csv: buildLocalCsv(transactions),
        model: "local",
        fallbackUsed: false,
        normalized: {
          files: csvFiles.length + ofxFiles.length,
          pdfs: pdfFiles.length,
          transactions: transactions.length,
          csvTotal: formatBRL(total),
          warnings,
          truncated,
        },
      });
    }

    const prompt = buildPrompt({
      normalizedCsv,
      total,
      pdfNames: pdfFiles.map((file) => file.originalname),
      warnings,
      truncated,
    });

    const parts = [
      { text: prompt },
      ...pdfFiles.map((file) => ({
        inline_data: {
          mime_type: "application/pdf",
          data: file.buffer.toString("base64"),
        },
      })),
    ];

    const body = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
    };

    const callGemini = async (model) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
        },
      );

      const responseText = await response.text();
      if (!response.ok) {
        return { ok: false, status: response.status, errText: responseText, model };
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        return {
          ok: false,
          status: response.status,
          errText: responseText || "Resposta vazia da API do Gemini",
          model,
        };
      }
      return { ok: true, data, model };
    };

    let result = await callGemini(GEMINI_MODEL);
    if (
      !result.ok &&
      GEMINI_FALLBACK_MODEL &&
      GEMINI_FALLBACK_MODEL !== GEMINI_MODEL
    ) {
      console.warn(
        `Falha no modelo ${GEMINI_MODEL}. Tentando fallback ${GEMINI_FALLBACK_MODEL}...`,
      );
      result = await callGemini(GEMINI_FALLBACK_MODEL);
    }

    if (!result.ok) {
      console.error(
        "Gemini API erro:",
        result.status,
        `model=${result.model}`,
        result.errText,
      );
      return res.status(500).json({
        error: "Erro na API do Gemini",
        details: result.errText,
        model: result.model,
      });
    }

    const text =
      result.data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .join("") || "";

    if (!text) {
      return res.status(500).json({ error: "Resposta vazia da API do Gemini" });
    }

    res.json({
      csv: text.trim(),
      model: result.model,
      fallbackUsed: result.model !== GEMINI_MODEL,
      normalized: {
        files: csvFiles.length + ofxFiles.length,
        pdfs: pdfFiles.length,
        transactions: transactions.length,
        csvTotal: formatBRL(total),
        warnings,
        truncated,
      },
    });
  } catch (err) {
    console.error(err);
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: "Arquivo muito grande. O limite atual e 20 MB por arquivo.",
        LIMIT_FILE_COUNT: "Arquivos demais. O limite atual e de 12 arquivos.",
        LIMIT_UNEXPECTED_FILE: "Campo de upload inesperado.",
      };
      return res.status(400).json({
        error: messages[err.code] || "Erro no upload dos arquivos.",
        details: err.message,
      });
    }

    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
});

app.get(/.*/, (req, res, next) => {
  if (!fs.existsSync(distDir)) return next();
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, () => {
  if (process.env.QUIET_DEV !== "true") {
    console.log(`Servidor API rodando em http://localhost:${PORT}`);
    console.log(`Modo Gemini habilitado: ${USE_GEMINI}`);
  }
});
