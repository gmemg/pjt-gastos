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

    const prompt = `Este e um prompt que sera usado num site. Os resultados deles devem ser padronizados em um formato CSV que utilizaremos para apresentar no site.\n\nAnalise esses CSVs de extratos e faturas. A partir deles, gere uma tabela com 3 colunas:\n* Categoria – E a categoria do gasto, por exemplo, Restaurantes, Transferencias pessoais, Servicos e assinaturas.\n* Descricao – E a descricao da categoria, da um resumo rapidinho do que e que entrou ai. Por exemplo, no restaurantes, pode falar algo como "Restaurantes como Vivano, McDonalds, etc". Ou em servicos, falar quais servicos. De forma breve.\n* Valor – valor gasto.\n\nApos essa tabela, veja se tem algum gasto alto em alguma categoria e destrinche ela.\n\nRegras de resposta:\n- Responda APENAS com CSV (sem markdown, sem texto extra).\n- Primeiro bloco: CSV da tabela principal com colunas: Categoria,Descricao,Valor.\n- Linha em branco.\n- Segundo bloco: CSV de detalhamento (apenas se houver), com colunas: Categoria,Descricao,Valor.\n\nCSVs a seguir:\n${combined}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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
      return res
        .status(500)
        .json({ error: "Erro na API do Gemini", details: errText });
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    if (!text) {
      return res.status(500).json({ error: "Resposta vazia da API do Gemini" });
    }

    res.json({ csv: text });
  } catch (err) {
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
