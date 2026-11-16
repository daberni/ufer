"use client";

import styles from "./live-announcements.module.css";

type Props = {
  polite: string;
  assertive: string;
};

// Both live regions stay mounted so that changes to their text are announced.
export function LiveAnnouncements({
  polite,
  assertive
}: Props) {
  return (
    <>
      <div className={styles["announcer"]} role="status">
        {polite}
      </div>
      <div className={styles["announcer"]} role="alert">
        {assertive}
      </div>
    </>
  );
}
