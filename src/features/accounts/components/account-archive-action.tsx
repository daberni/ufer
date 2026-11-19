"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Archive, ArchiveRestore } from "lucide-react";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { useArchiveAccount } from "@/features/accounts/mutations";
import type { Account } from "@/features/accounts/types";

/** Archiving is reversible and keeps every booking and report contribution, so it needs no confirmation. */
export function AccountArchiveAction({ account }: {
  account: Account
}) {
  const archive = useArchiveAccount(account.id);
  const archived = account.archived_at !== null;

  return (
    <>
      <button className={ui["button"]} disabled={archive.isPending} onClick={() => archive.mutate(!archived)}>
        {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        {archived ? "Restore account" : "Archive account"}
      </button>
      <FormError failure={archive.error ? toFailure(archive.error) : null} />
    </>
  );
}
