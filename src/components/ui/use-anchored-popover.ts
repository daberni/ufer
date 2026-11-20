"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { popoverMaxWidth, popoverPlacement, visibleArea } from "./popover-placement";

type Options = {
  open: boolean;
  /** The control the popover opens below or above. */
  anchorRef: RefObject<HTMLElement | null>;
  /** An element with popover="manual" and position: fixed. */
  popupRef: RefObject<HTMLElement | null>;
  /** Makes the popover at least as wide as its control, as for a list of the control's values. */
  matchAnchorWidth?: boolean;
};

/**
 * Shows a manual popover in the top layer while open and keeps it anchored to its control inside the visible area, following scrolling, resizing and an
 * on-screen keyboard. Content in the top layer neither moves the surrounding layout nor gets clipped by a dialog.
 */
export function useAnchoredPopover({
  open,
  anchorRef,
  popupRef,
  matchAnchorWidth = false
}: Options) {
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;

    if (!anchor || !popup) {
      return;
    }

    const visible = visibleArea();
    const anchorBox = anchor.getBoundingClientRect();

    if (matchAnchorWidth) {
      popup.style.minWidth = `${anchorBox.width}px`;
    }

    popup.style.maxWidth = `${popoverMaxWidth(visible)}px`;
    popup.style.maxHeight = "";

    const placement = popoverPlacement(anchorBox, {
      width: popup.offsetWidth,
      height: popup.offsetHeight
    }, visible);

    popup.style.top = `${placement.top}px`;
    popup.style.left = `${placement.left}px`;
    popup.style.maxHeight = `${placement.maxHeight}px`;
  }, [anchorRef, popupRef, matchAnchorWidth]);

  useLayoutEffect(() => {
    const popup = popupRef.current;

    if (!popup?.showPopover) {
      return;
    }

    const showing = popup.matches(":popover-open");

    if (!open) {
      if (showing) {
        popup.hidePopover();
      }

      return;
    }

    if (!showing) {
      popup.showPopover();
    }

    place();
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    function placeUnlessPopupScrolled(event: Event) {
      const target = event.target as Node | null;

      if (!popupRef.current?.contains(target)) {
        place();
      }
    }

    const viewport = window.visualViewport;

    document.addEventListener("scroll", placeUnlessPopupScrolled, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);

    return () => {
      document.removeEventListener("scroll", placeUnlessPopupScrolled, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open, place, popupRef]);
}
