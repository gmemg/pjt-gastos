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

    const combined = files
      .map((f, idx) => {
        const text = f.buffer.toString("utf8");
        return `### ARQUIVO ${idx + 1}: ${f.originalname}\n${text}`;
      })
      .join("\n\n");

    const prompt = `Este e um prompt que sera usado num site. Os resultados devem ser padronizados em CSV para apresentacao.\n\nAnalise esses CSVs de extratos e faturas. Gere uma tabela com 3 colunas:\n* Categoria – categoria do gasto (ex: Restaurantes, Transferencias pessoais, Servicos e assinaturas).\n* Descricao – resumo breve do que entra na categoria (cite exemplos reais se aparecerem nos CSVs).\n* Valor – total gasto na categoria.\n\nOrganizacao e padronizacao:\n- Normalize nomes de categorias (evite duplicidades por variacao de nome).\n- Some valores por categoria.\n- Ordene da maior para a menor por Valor.\n- Use apenas numero em Valor (ex: 1234.56). Sem moeda, sem separador de milhar.\n- Se fizer sentido, inclua uma linha final de TOTAL (Categoria=TOTAL, Descricao=Total geral, Valor=...)\n\nDetalhamento:\n- Identifique a categoria com gasto mais alto (ou claramente fora da media) e destrinche em um segundo bloco.\n- No detalhamento use as mesmas 3 colunas e valores somados.\n- Se nao houver destaque relevante, nao gere o segundo bloco.\n\nRegras de resposta:\n- Responda APENAS com CSV (sem markdown, sem texto extra).\n- Primeiro bloco: CSV da tabela principal com colunas: Categoria,Descricao,Valor.\n- Linha em branco.\n- Segundo bloco (opcional): CSV de detalhamento com colunas: Categoria,Descricao,Valor.\n\nCSVs a seguir:\n${combined}`;

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
