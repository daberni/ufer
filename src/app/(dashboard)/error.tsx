"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { Empty } from "@/components/ui/empty-state";

/** Sits inside the dashboard layout, so the sidebar and header stay usable when a view fails to render. */
export default function DashboardError({
  retry
}: {
  error: unknown;
  retry: () => void;
}) {
  const t = useTranslations();

  return (
    <Empty
      title={t("shell.viewError.title")}
      action={<button className={clsx(ui["button"], ui["primary"])} onClick={retry}>{t("common.tryAgain")}</button>}
    >
      {t("shell.viewError.body")}
    </Empty>
  );
}
