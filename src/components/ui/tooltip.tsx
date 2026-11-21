"use client";

import styles from "./tooltip.module.css";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismiss } from "./use-dismiss";

const hoverDelay = 400;
const longPressDelay = 500;
const maxWidth = 320;

export type TooltipTriggerProps = {
  ref: (element: HTMLElement | null) => void;
  "aria-describedby"?: string;
  tabIndex?: number;
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onClickCapture: (event: MouseEvent) => void;
  onFocus: (event: FocusEvent) => void;
  onBlur: () => void;
};

type Props = {
  text: string;
  /** Links the text to the trigger as its description; off when the trigger's name or another description already says it. */
  describes?: boolean;
  /** Shows the text only while the trigger cuts its own text off, such as a long name with an ellipsis. */
  onlyWhenTruncated?: boolean;
  /** Renders the trigger with the given props spread onto it. */
  children: (trigger: TooltipTriggerProps) => ReactNode;
};

// Covers an ellipsis on one line and a line clamp, which cuts text off vertically.
function isTruncated(element: HTMLElement) {
  return [element, ...element.querySelectorAll<HTMLElement>("*")].some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);
}

// A tap on a control activates it, so only text that does nothing else shows its tooltip on a tap; controls show it on a long press.
function tapActivates(element: HTMLElement) {
  return element.closest("button, a[href], input, select, textarea, label, [role='button']") !== null;
}

const focusable = "button, a[href], input, select, textarea, summary, [tabindex]";

/** One pending show or hide and whether the last press was a long press, kept outside rendering. */
function usePressTimer() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    schedule: (action: () => void, delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(action, delay);
    },
    cancel: () => clearTimeout(timer.current),
    setLongPressed: (value: boolean) => {
      longPressed.current = value;
    },
    wasLongPressed: () => longPressed.current
  };
}

/**
 * A short text about a trigger in the top layer, shown on hover, on keyboard focus and on a long press or, for text that does nothing else, a tap. It replaces
 * the title attribute, which touch and keyboard users cannot reach. Escape and a press outside hide it.
 */
export function Tooltip({
  text,
  describes = true,
  onlyWhenTruncated = false,
  children
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLSpanElement>(null);
  // A long press shows the tooltip; the browser's context menu and the click that may follow do not act on the trigger.
  const press = usePressTimer();

  // Truncated text outside any control becomes a focus stop of its own, so keyboard users can reach the full text.
  const [ownFocusStop, setOwnFocusStop] = useState(false);
  const showRef = useRef(show);

  useLayoutEffect(() => {
    triggerRef.current = triggerElement;
    showRef.current = show;
  });

  useEffect(() => {
    const focusOwner = triggerElement?.parentElement?.closest<HTMLElement>(focusable);

    if (!triggerElement) {
      return;
    }

    // Text inside a link or button cannot take focus itself; its control's keyboard focus shows the tooltip instead.
    if (focusOwner) {
      const showOnVisibleFocus = () => {
        if (focusOwner.matches(":focus-visible")) {
          showRef.current();
        }
      };
      const hideOnBlur = () => setOpen(false);

      focusOwner.addEventListener("focus", showOnVisibleFocus);
      focusOwner.addEventListener("blur", hideOnBlur);

      return () => {
        focusOwner.removeEventListener("focus", showOnVisibleFocus);
        focusOwner.removeEventListener("blur", hideOnBlur);
      };
    }

    // Decorative copies, such as previews and drag images, stay out of the tab order.
    const decorative = triggerElement.closest("[aria-hidden='true'], [inert]") !== null;

    if (!onlyWhenTruncated || decorative || triggerElement.matches(focusable)) {
      return;
    }

    const measure = () => setOwnFocusStop(isTruncated(triggerElement));
    const observer = new ResizeObserver(measure);

    // The observer reports size changes of the trigger; a new text of the same size is measured when it renders.
    measure();
    observer.observe(triggerElement);

    return () => {
      observer.disconnect();
      setOwnFocusStop(false);
    };
  }, [triggerElement, onlyWhenTruncated, text]);

  useAnchoredPopover({
    open,
    anchorRef: triggerRef,
    popupRef,
    maxWidth
  });

  useDismiss({
    active: open,
    inside: [triggerRef],
    onDismiss: () => setOpen(false)
  });

  function show() {
    press.cancel();

    if (!text || !triggerElement || (onlyWhenTruncated && !isTruncated(triggerElement))) {
      return false;
    }

    setOpen(true);

    return true;
  }

  function hide() {
    press.cancel();
    setOpen(false);
  }

  const trigger: TooltipTriggerProps = {
    ref: setTriggerElement,
    "aria-describedby": describes && text ? id : undefined,
    tabIndex: ownFocusStop ? 0 : undefined,
    onPointerEnter: event => {
      if (event.pointerType === "mouse") {
        press.schedule(show, hoverDelay);
      }
    },
    onPointerLeave: event => {
      if (event.pointerType === "mouse") {
        hide();
      }
    },
    onPointerDown: event => {
      press.setLongPressed(false);

      if (event.pointerType !== "mouse") {
        // Only a long press that opened the tooltip swallows the click that follows; otherwise the control still acts.
        press.schedule(() => press.setLongPressed(show()), longPressDelay);
      }
    },
    onPointerUp: press.cancel,
    onPointerCancel: press.cancel,
    onContextMenu: event => {
      if (press.wasLongPressed()) {
        event.preventDefault();
      }
    },
    onClickCapture: event => {
      if (press.wasLongPressed()) {
        press.setLongPressed(false);
        event.preventDefault();
        event.stopPropagation();

        return;
      }

      if (!tapActivates(event.currentTarget as HTMLElement)) {
        if (open) {
          hide();
        } else {
          show();
        }
      }
    },
    onFocus: event => {
      if (event.currentTarget.matches(":focus-visible")) {
        show();
      }
    },
    onBlur: hide
  };

  return (
    <>
      {children(trigger)}
      <span
        ref={popupRef}
        id={id}
        className={styles["tooltip"]}
        popover="manual"
        role="tooltip"
      >
        {/* A description stays in the document for assistive technology; a visual-only copy of visible text joins it only while shown. */}
        <span className={styles["text"]}>{(open || describes) && text}</span>
      </span>
    </>
  );
}
