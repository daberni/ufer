"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import styles from "./view-loading.module.css";
import { loadingDelay } from "@/features/dashboard/use-area-result";

/**
 * Placeholder for a view whose first results are still loading. Fast responses replace it before the indicator appears; a failed load leaves the space to the load error banner.
 */
export function ViewLoading({ failed }: {
  failed: boolean
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), loadingDelay);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles["loading-state"]} aria-busy={!failed}>
      {visible && !failed && (
        <>
          <RefreshCw size={22} className={ui["spinning"]} /> Loading …
        </>
      )}
    </div>
  );
}
