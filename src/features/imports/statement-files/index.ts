import { decodeCsv } from "../csv-reading";
import { looksLikeCamt, readCamt053 } from "./camt053";
import { looksLikeOfx, readOfx } from "./ofx";
import { looksLikeQif, readQif } from "./qif";
import { StatementFileError, type StatementFile } from "./statement-rows";
import type { ImportMessages } from "../import-messages";

export { StatementFileError, statementFormatLabels, type StatementFile, type StatementFormat } from "./statement-rows";

/** XML statements may be UTF-16 (by byte order mark or the zero bytes around `<`) or declare another encoding in their prolog; everything else decodes like CSV. */
function decodeStatement(bytes: Uint8Array) {
  const littleEndian = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
  const bigEndian = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c);

  if (littleEndian) {
    return new TextDecoder("utf-16le").decode(bytes);
  }

  if (bigEndian) {
    return new TextDecoder("utf-16be").decode(bytes);
  }

  const declared = /^(?:\uFEFF)?<\?xml[^>]*\sencoding=["']([A-Za-z0-9._-]+)["']/.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 200)))?.[1];

  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // An encoding the browser does not know falls back to detection.
    }
  }

  return decodeCsv(bytes).text;
}

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
export function readStatementFile(bytes: Uint8Array, t: ImportMessages): StatementFile | {
  error: string;
} | null {
  // XML declares its encoding, but statements in practice are UTF-8; legacy OFX and QIF files may be Windows-1252, which the CSV decoder detects.
  const text = decodeStatement(bytes);
  const reader = readers.find(candidate => candidate.recognizes(text))?.read;

  if (!reader) {
    return null;
  }

  try {
    return reader(text, t);
  } catch (error) {
    if (error instanceof StatementFileError) {
      return {
        error: error.message
      };
    }

    throw error;
  }
}
