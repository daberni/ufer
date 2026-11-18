import ui from "../ui/primitives.module.css";

import styles from "./page-heading.module.css";

type Props = {
  heading: React.ReactNode;
  description: string;
  /** Actions beside the heading, such as the sync button. */
  children?: React.ReactNode;
};

export function PageHeading({
  heading,
  description,
  children
}: Props) {
  return (
    <div className={styles["page-heading"]}>
      <div>
        <span className={ui["eyebrow"]}>CLARITY FOR YOUR FINANCES</span>
        <h1>{heading}</h1>
        <p className={styles["description"]}>{description}</p>
      </div>
      {children}
    </div>
  );
}
