import type { CsvBlock } from "../types";

export function splitCsvBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (!inQuotes && ch === "\n" && next === "\n") {
      if (current.trim()) blocks.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

function detectDelimiter(sample: string): string {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;

  for (let i = 0; i < sample.length; i += 1) {
    const ch = sample[i];
    const next = sample[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch in counts) {
      counts[ch as keyof typeof counts] += 1;
    }
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseCsvBlock(block: string): CsvBlock | null {
  if (!block.trim()) return null;
  const sample = block.split(/\r?\n/).slice(0, 8).join("\n");
  const delimiter = detectDelimiter(sample);
  const rows = parseRows(block, delimiter);
  if (!rows.length) return null;

  return {
    headers: rows[0].map((header) => header.trim()),
    rows: rows.slice(1),
  };
}

export function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  let raw = value.trim().replace(/[^\d,.\-]/g, "");
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
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
