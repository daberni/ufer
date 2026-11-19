/** A file chosen in the import dialog, handed to the import page in memory; it is taken once and never stored. */
let pendingFile: File | null = null;

export function handOverImportFile(file: File) {
  pendingFile = file;
}

export function takeImportFile() {
  const file = pendingFile;

  pendingFile = null;

  return file;
}
