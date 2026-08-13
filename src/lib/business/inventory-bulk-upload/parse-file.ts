// @polsia:user-owned — bulk-upload file parser. Pure (no DB, no
// `process.env`); imported only by server route handlers (preview,
// commit) which then pass the `SpreadsheetModel` into the per-row
// validator.
//
// Supports XLSX / XLS / CSV. The CSV path reuses the canonical parser
// in `src/lib/csv/lots.ts` so RFC-4180 quirks (BOM, CRLF, quoted
// commas, doubled-quotes) match the legacy single-file upload flow.
// XLSX is parsed via SheetJS, server-only. Client code MUST NOT
// import xlsx — the wizard only reads the file via `apiFetch`, never
// via parsing on the client.

import * as XLSX from 'xlsx';
import { type ParsedLotsCsv, parseLotsCsv } from '@/lib/csv/lots';

// Truncate a parsed spreadsheet to a sane upper bound so a 50 MB
// accidental upload can't blow up the request hot path.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 5000;

export type SpreadsheetModel = ParsedLotsCsv;

const XLSX_EXT = /\.(xlsx|xls|xlsb|xlsm)$/i;
const CSV_EXT = /\.(csv|txt)$/i;

export function splitFilename(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

export interface ParsedFile {
  kind: 'xlsx' | 'csv';
  model: SpreadsheetModel;
  // First sheet's display name, only populated for xlsx (helpful in
  // errors so the seller knows which sheet we read).
  sheetName: string | null;
}

export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit`);
  }
  const { ext } = splitFilename(file.name);
  if (XLSX_EXT.test(ext) || XLSX_EXT.test(file.name)) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const firstName = wb.SheetNames[0];
    if (!firstName) throw new Error('Workbook contained no sheets');
    const sheet = wb.Sheets[firstName];
    if (!sheet) throw new Error('Workbook contained no sheets');
    const aoa = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
    });
    if (aoa.length === 0)
      return { kind: 'xlsx', model: { headers: [], rows: [] }, sheetName: firstName };
    const headerRowRaw = aoa[0] ?? [];
    const headers = headerRowRaw.map((c) => String(c ?? '').trim());
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const line = aoa[i];
      if (!line || line.every((c) => String(c ?? '').trim() === '')) continue;
      // Skip blank lines completely so an empty row mid-sheet doesn't
      // appear as a spurious error.
      const obj: Record<string, string> = {};
      headers.forEach((h, c) => {
        const raw = line[c];
        obj[h] = raw === undefined || raw === null ? '' : String(raw).trim();
      });
      rows.push(obj);
      if (rows.length > MAX_ROWS) {
        throw new Error(`Spreadsheet has more than ${MAX_ROWS} data rows; cap is ${MAX_ROWS}`);
      }
    }
    return { kind: 'xlsx', model: { headers, rows }, sheetName: firstName };
  }
  if (CSV_EXT.test(ext) || CSV_EXT.test(file.name) || file.type === 'text/csv') {
    const text = buf.toString('utf8');
    return { kind: 'csv', model: parseLotsCsv(text), sheetName: null };
  }
  throw new Error('Unsupported file type — upload a .csv, .xlsx, .xls, or .txt file');
}
