import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { BrandIcon } from "@/components/branding/brand-icon";
import { describeDate } from "@/lib/date-format";
import { LegalLinks } from "./legal-links";
import { SourceCodeNotice } from "./source-code-notice";
import styles from "./legal-document.module.css";

type Props = {
  title: string;
  /** The date this text last changed (YYYY-MM-DD); maintained with the text, never derived from the request. */
  lastUpdated: string;
  children: React.ReactNode;
};

/** Public page shell for the privacy notice and terms; it renders without a session and loads no financial data. */
export function LegalDocument({
  title,
  lastUpdated,
  children
}: Props) {
  const updated = describeDate(Temporal.PlainDate.from(lastUpdated));

  return (
    <div className={styles["legal-page"]}>
      <header className={styles["header"]}>
        <Link href="/" className={styles["home-link"]}>
          <ArrowLeft size={16} />
          <BrandIcon size={24} />
          Back to Ufer
        </Link>
      </header>
      <main className={styles["document"]}>
        <h1>{title}</h1>
        <p className={styles["updated"]}>
          Last updated: <time dateTime={updated.dateTime}>{updated.title}</time>
        </p>
        {children}
      </main>
      <footer className={styles["footer"]}>
        <LegalLinks />
        <SourceCodeNotice />
      </footer>
    </div>
  );
}
