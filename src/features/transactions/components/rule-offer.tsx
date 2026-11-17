"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { popoverMaxWidth, popoverPlacement, visibleArea } from "@/components/ui/popover-placement";
import styles from "./rule-offer.module.css";

type Props = {
  anchor: RefObject<HTMLElement | null>;
  payee: string;
  category: string;
  onCreate: () => void;
  onDismiss: () => void;
};

const anchorGap = 8;
const viewportMargin = 16;

/** A suggestion beside its category field in DOM order, raised above scrolling tables without moving their rows. */
export function RuleOffer({
  anchor,
  payee,
  category,
  onCreate,
  onDismiss
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const contextId = useId();
  const context = `${payee} → ${category}`;
  const place = useCallback(() => {
    const source = anchor.current;
    const popup = popupRef.current;

    if (!source || !popup) {
      return;
    }

    const box = source.getBoundingClientRect();
    const visible = visibleArea();

    popup.style.maxWidth = `${popoverMaxWidth(visible)}px`;
    popup.style.maxHeight = "";

    const placement = popoverPlacement(box, {
      width: popup.offsetWidth,
      height: popup.offsetHeight
    }, visible);
    const above = box.top - anchorGap - popup.offsetHeight;
    const fitsAbove = above >= visible.top + viewportMargin;

    // Prefer the space above the edited row, keeping the following category controls available for batch categorization.
    popup.style.top = `${fitsAbove ? above : placement.top}px`;
    popup.style.left = `${placement.left}px`;
    popup.style.maxHeight = `${fitsAbove ? box.top - visible.top - anchorGap - viewportMargin : placement.maxHeight}px`;
  }, [anchor]);

  useLayoutEffect(() => {
    const popup = popupRef.current;

    if (!popup?.showPopover) {
      return;
    }

    const showing = popup.matches(":popover-open");

    if (!showing) {
      popup.showPopover();
    }

    place();
  }, [place, payee, category]);

  useEffect(() => {
    function followSource(event: Event) {
      if (event.target !== popupRef.current) {
        place();
      }
    }

    const viewport = window.visualViewport;

    document.addEventListener("scroll", followSource, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);

    return () => {
      document.removeEventListener("scroll", followSource, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [place]);

  return (
    <div
      ref={popupRef}
      className={styles["offer"]}
      popover="manual"
      role="region"
      aria-labelledby={titleId}
      aria-describedby={contextId}
    >
      <div className={styles["heading"]}>
        <strong id={titleId}><Check size={16} aria-hidden="true" />Category saved</strong>
        <button
          type="button"
          className={clsx(ui["icon-button"], styles["dismiss"])}
          aria-label="Dismiss rule suggestion"
          onClick={onDismiss}
        >
          <X size={18} />
        </button>
      </div>
      <p id={contextId} className={styles["context"]} title={context}>{context}</p>
      <button
        type="button"
        className={clsx(ui["button"], ui["primary"], styles["create"])}
        aria-haspopup="dialog"
        onClick={onCreate}
      >
        <Sparkles size={16} aria-hidden="true" />Create rule…
      </button>
    </div>
  );
}
