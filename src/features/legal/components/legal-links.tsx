import { clsx } from "clsx";
import Link from "next/link";
import styles from "./legal-links.module.css";

export function LegalLinks({ className }: {
  className?: string
}) {
  return (
    <nav aria-label="Legal" className={clsx(styles["legal-links"], className)}>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </nav>
  );
}
