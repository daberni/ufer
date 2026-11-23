import { clsx } from "clsx";
import Link from "next/link";
import { useTranslations } from "next-intl";
import styles from "./legal-links.module.css";

export function LegalLinks({ className }: {
  className?: string
}) {
  const t = useTranslations("legal.links");

  return (
    <nav aria-label={t("label")} className={clsx(styles["legal-links"], className)}>
      <Link href="/privacy">{t("privacy")}</Link>
      <Link href="/terms">{t("terms")}</Link>
    </nav>
  );
}
