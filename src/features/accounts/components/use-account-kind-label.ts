"use client";

import { useTranslations } from "next-intl";
import { storedAccountKinds, type StoredAccountKind } from "../account-kinds";

function isStoredKind(kind: string): kind is StoredAccountKind {
  return (storedAccountKinds as readonly string[]).includes(kind);
}

/** Names an account kind in the interface language; an unknown stored kind is shown as it is. */
export function useAccountKindLabel() {
  const t = useTranslations("accounts.kinds");

  return (kind: string) => isStoredKind(kind) ? t(kind) : kind;
}
