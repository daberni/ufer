import styles from "./empty-state.module.css";
import type { ReactNode } from "react";
import { ShoreIllustration } from "@/components/branding/illustrations";

type IllustrationComponent = (props: {
  className?: string;
}) => ReactNode;

/** Pass `illustration={null}` where another illustrated empty state is already visible on the same screen. */
export function Empty({
  title,
  children,
  action,
  illustration: Illustration = ShoreIllustration
}: {
  title: string;
  // Plain text only: controls belong in `action`, which renders below the paragraph.
  children: string;
  action?: ReactNode;
  illustration?: IllustrationComponent | null;
}) {
  return (
    <div className={styles["empty"]}>
      {Illustration && <Illustration className={styles["illustration"]} />}
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
