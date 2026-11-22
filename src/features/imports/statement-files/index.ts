import { decodeCsv } from "../csv-reading";
import { looksLikeCamt, readCamt053 } from "./camt053";
import { looksLikeOfx, readOfx } from "./ofx";
import { looksLikeQif, readQif } from "./qif";
import { StatementFileError, type StatementFile } from "./statement-rows";

export { StatementFileError, statementFormatLabels, type StatementFile, type StatementFormat } from "./statement-rows";

const readers = [
  {
    recognizes: looksLikeCamt,
    read: readCamt053
  },
  {
    recognizes: looksLikeOfx,
    read: readOfx
  },
  {
    recognizes: looksLikeQif,
    read: readQif
  }
];

// Recognizes structured statement files by content, whatever their file name; everything else is read as CSV.

/**
 * Reads a CAMT.053, OFX/QFX or QIF file into mapped rows; null when the content is none of them. A recognized file that cannot be imported, such as another CAMT message or an investment statement, yields its reason.
 */
export function readStatementFile(bytes: Uint8Array, locale: string): StatementFile | {
  error: string;
} | null {
  // XML declares its encoding, but statements in practice are UTF-8; legacy OFX and QIF files may be Windows-1252, which the CSV decoder detects.
  const { text } = decodeCsv(bytes);
  const reader = readers.find(candidate => candidate.recognizes(text))?.read;

  if (!reader) {
    return null;
  }

  try {
    return reader(text, locale);
  } catch (error) {
    if (error instanceof StatementFileError) {
      return {
        error: error.message
      };
    }

    throw error;
  }
}
