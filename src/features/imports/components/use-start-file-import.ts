"use client";

import { useRouter } from "next/navigation";
import { importPath } from "@/client/app-location";
import { handOverImportFile } from "@/features/imports/pending-import-file";

/** Opens the import page with a file already loaded, optionally preselecting the account the file was dropped on. */
export function useStartFileImport() {
  const router = useRouter();

  return (file: File, accountId: string | null = null) => {
    handOverImportFile(file, accountId);
    router.push(importPath);
  };
}
