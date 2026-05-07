export type CsvBlock = {
  headers: string[];
  rows: string[][];
};

export type HistoryItem = {
  id: string;
  date: string;
  files: string[];
  csv: string;
  normalized?: AnalyzeResponse["normalized"];
};

export type AnalyzeResponse = {
  csv?: string;
  model?: string;
  fallbackUsed?: boolean;
  normalized?: {
    files: number;
    pdfs: number;
    transactions: number;
    csvTotal: string;
    warnings: string[];
    truncated: boolean;
  };
  error?: string;
  details?: string;
};
