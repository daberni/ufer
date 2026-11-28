/** File types the import's file choosers offer; detection reads the content, so another extension still imports when chosen anyway. */
export const importFileTypes = ".csv,.txt,text/csv,.xml,.ofx,.qfx,.qif";

/** A file chosen or dropped outside the import page, with the account it was dropped on, if any. */
export type PendingImportFile = {
  file: File;
  accountId: string | null;
};

/** Handed to the import page in memory; it is taken once and never stored. */
let pending: PendingImportFile | null = null;

export function handOverImportFile(file: File, accountId: string | null = null) {
  pending = {
    file,
    accountId
  };
}

export function takeImportFile() {
  const taken = pending;

  pending = null;

  return taken;
}
