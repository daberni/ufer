import { parse } from "csv-parse/browser/esm/sync";

// Decodes and parses CSV exports in the browser. Shared with the server, so it must stay free of server-only imports.

export type CsvEncoding = "utf-8" | "windows-1252";

export type CsvDelimiter = "," | ";" | "\t" | "|";

/** Decodes file bytes: a UTF-8 BOM or valid UTF-8 means UTF-8, anything else is read as Windows-1252, the usual encoding of legacy bank exports. */
export function decodeCsv(bytes: Uint8Array, encoding?: CsvEncoding): {
  text: string;
  encoding: CsvEncoding;
} {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;

  if (encoding === "windows-1252") {
    return {
      text: new TextDecoder("windows-1252").decode(body),
      encoding
    };
  }

  try {
    return {
      text: new TextDecoder("utf-8", {
        fatal: true
      }).decode(body),
      encoding: "utf-8"
    };
  } catch {
    if (encoding === "utf-8") {
      return {
        text: new TextDecoder("utf-8").decode(body),
        encoding
      };
    }

    return {
      text: new TextDecoder("windows-1252").decode(body),
      encoding: "windows-1252"
    };
  }
}

const delimiters: CsvDelimiter[] = [";", ",", "\t", "|"];

/** The candidate delimiter that splits the first records into the most columns, counting only records with the header's column count. */
export function detectDelimiter(text: string): CsvDelimiter {
  const scores = delimiters.map(delimiter => {
    try {
      const [header = [], ...rows] = parseCsv(text, delimiter, 50);

      return header.length < 2 ? 0 : header.length * (1 + rows.filter(row => row.length === header.length).length);
    } catch {
      return 0;
    }
  });
  const best = scores.indexOf(Math.max(...scores));

  return scores[best] > 0 ? delimiters[best] : ",";
}

/** The header and data rows of a file read with the given settings; null when the file is not valid CSV with them, such as an unterminated quoted field. */
export function readCsvTable(bytes: Uint8Array, settings: {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
}) {
  const text = decodeCsv(bytes, settings.encoding).text;
  let records: ReturnType<typeof parseCsvRecords>;

  try {
    records = parseCsvRecords(text, settings.delimiter);
  } catch {
    return null;
  }

  const [header, ...rows] = records;

  return {
    header: header?.cells ?? [],
    rows: rows.map(record => record.cells),
    lines: rows.map(record => record.line)
  };
}

/** A CSV record with the physical line it starts on, counting from 1. */
export type CsvRecord = {
  cells: string[];
  line: number;
};

/** Parses CSV text with csv-parse into trimmed cells; quotes inside unquoted cells are literal, line endings may be mixed, and blank records are dropped. */
export function parseCsvRecords(text: string, delimiter: string, toLine?: number): CsvRecord[] {
  // With `info`, csv-parse returns each record with its parsing metadata.
  const records = parse(text, {
    delimiter,
    record_delimiter: ["\r\n", "\n", "\r"],
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    info: true,
    to_line: toLine
  }) as unknown as {
    record: string[];
    info: {
      lines: number;
    };
  }[];

  return records.map(({
    record,
    info
  }) => ({
    cells: record.map(cell => cell.trim()),
    // csv-parse reports the line a record ends on and counts each \r and \n inside quotes as a line, so the same count moves the start back.
    line: info.lines - record.reduce((breaks, cell) => breaks + (cell.match(/\r|\n/g)?.length ?? 0), 0)
  })).filter(record => record.cells.some(cell => cell !== ""));
}

export function parseCsv(text: string, delimiter: string, toLine?: number): string[][] {
  return parseCsvRecords(text, delimiter, toLine).map(record => record.cells);
}
