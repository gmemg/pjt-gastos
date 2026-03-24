import express from "express";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
const MAX_CHARS = Number.parseInt(process.env.MAX_CHARS || "120000", 10);
const MAX_LINES_PER_FILE = Number.parseInt(
  process.env.MAX_LINES_PER_FILE || "1500",
  10,
);

app.use(express.static("public"));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", upload.array("files"), async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY nao configurada." });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "Envie ao menos um arquivo CSV." });
    }

    let truncated = false;
    const combined = files
      .map((f, idx) => {
        let text = f.buffer.toString("utf8");
        const lines = text.split(/\r?\n/);
        if (lines.length > MAX_LINES_PER_FILE) {
          text = lines.slice(0, MAX_LINES_PER_FILE).join("\n");
          truncated = true;
        }
        return `### ARQUIVO ${idx + 1}: ${f.originalname}\n${text}`;
      })
      .join("\n\n");
    let trimmedCombined = combined;
    if (combined.length > MAX_CHARS) {
      trimmedCombined = combined.slice(0, MAX_CHARS);
      truncated = true;
    }

    const prompt = `Analise os CSVs e gere uma tabela em CSV com 3 colunas:\n\"Categoria\";\"Descricao\";\"Valor\"\n\nRegras:\n- Use ponto e virgula (;) como delimitador.\n- Envolva TODOS os campos em aspas duplas.\n- Normalize categorias e some valores por categoria.\n- Ordene por Valor desc.\n- Valor deve vir com moeda BRL no formato \"R$ 1.234,56\".\n- Inclua linha TOTAL quando fizer sentido (Categoria=TOTAL, Descricao=Total geral, Valor=R$ ...).\n\nDetalhamento:\n- Gere um segundo bloco CSV com as 3 categorias mais altas (ou mais relevantes) detalhadas.\n- Se nao houver destaque, ainda assim gere as 3 maiores categorias.\n\nResponda APENAS com CSV. Primeiro bloco (tabela principal), linha em branco, segundo bloco (detalhamento).\n${truncated ? "\nObservacao: dados podem estar truncados para reduzir tempo." : ""}\n\nCSVs:\n${trimmedCombined}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
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

      if (!response.ok) {
        const errText = await response.text();
        return { ok: false, status: response.status, errText, model };
      }

      const data = await response.json();
      return { ok: true, data, model };
    };

    let result = await callGemini(GEMINI_MODEL);
    if (!result.ok && GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
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

    const data = result.data;
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    if (!text) {
      return res.status(500).json({ error: "Resposta vazia da API do Gemini" });
    }

    res.json({
      csv: text,
      model: result.model,
      fallbackUsed: result.model !== GEMINI_MODEL,
    });
  } catch (err) {
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`GEMINI_API_KEY configurada: ${Boolean(GEMINI_API_KEY)}`);
});
