"use client";

import ui from "./primitives.module.css";

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
      <div className={ui["visually-hidden"]} role="status">
        {polite}
      </div>
      <div className={ui["visually-hidden"]} role="alert">
        {assertive}
      </div>
    </>
  );
}
