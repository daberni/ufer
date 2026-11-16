import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { Empty } from "@/components/ui/empty-state";
import ui from "@/components/ui/primitives.module.css";
import styles from "./not-found.module.css";

export const metadata: Metadata = {
  title: "Page not found"
};

// Replaces the built-in 404 page, whose inline styles the Content-Security-Policy blocks.
export default function NotFound() {
  return (
    <main className={styles["page"]}>
      <Empty title="Page not found" action={<Link href="/" className={clsx(ui["button"], ui["primary"], styles["home-link"])}>Back to Ufer</Link>}>
        This address does not lead to a page in Ufer.
      </Empty>
    </main>
  );
}
