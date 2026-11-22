"use client";

import ui from "./primitives.module.css";
import styles from "./action-menu.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismiss } from "./use-dismiss";

// The --mobile custom media in src/styles/media.css; both width and pointer changes switch the layout.
const phoneLayout = "(width <= 760px), (width <= 900px) and (pointer: coarse)";

type MenuContext = {
  /** Closes the menu and returns focus to its button, so a dialog opened next restores focus there. */
  close: () => void;
};

const MenuContext = createContext<MenuContext>({
  close: () => undefined
});

type ItemProps = {
  icon?: ReactNode;
  /** Shows the entry only on phones, where it replaces a button the wider layout shows beside the menu. */
  phoneOnly?: boolean;
  /** Marks an action that removes data. */
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

/** A "…" button that opens a menu of rarely used actions; arrow keys, Home and End move between them and Escape or a press outside closes it. */
export function ActionMenu({
  label,
  appearance = "icon",
  phoneOnly = false,
  children
}: {
  /** The button's accessible name, such as "Actions for Synthetic checking". */
  label: string;
  /** "button" matches the height and border of neighbouring buttons, as beside a page heading's primary action. */
  appearance?: "icon" | "button";
  /** Shows the menu only on phones, where it collects actions the wider layout shows as buttons. */
  phoneOnly?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useDismiss({
    active: open,
    inside: [triggerRef, popupRef],
    onDismiss: dismissal => {
      setOpen(false);

      if (dismissal.focusInside) {
        triggerRef.current?.focus();
      }
    }
  });
  useAnchoredPopover({
    open,
    anchorRef: triggerRef,
    popupRef
  });

  // Crossing the phone breakpoint, for example on rotation, can hide the trigger of a phone-only menu or the focused phone-only entry.
  useEffect(() => {
    const trigger = triggerRef.current;

    if (!open || !trigger) {
      return;
    }

    const view = trigger.ownerDocument.defaultView;

    // Runs after the layout change, so the hidden state is already computed.
    function followLayout() {
      if (!trigger || !view) {
        return;
      }

      if (view.getComputedStyle(trigger).display === "none") {
        setOpen(false);

        return;
      }

      // Browsers move focus from an entry that becomes hidden to the document body.
      const focused = trigger.ownerDocument.activeElement;
      const lostFocus = !focused || focused === trigger.ownerDocument.body || (popupRef.current?.contains(focused) && view.getComputedStyle(focused).display === "none");

      if (lostFocus) {
        menuItems(popupRef.current)[0]?.focus();
      }
    }

    const layout = view?.matchMedia(phoneLayout);

    layout?.addEventListener("change", followLayout);

    return () => layout?.removeEventListener("change", followLayout);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const items = menuItems(popupRef.current);

    (focusLast ? items.at(-1) : items[0])?.focus();
  }, [open, focusLast]);

  function openMenu(last: boolean) {
    setFocusLast(last);
    setOpen(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowUp");
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent) {
    const items = menuItems(popupRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const targets: Record<string, number> = {
      ArrowDown: (current + 1) % items.length,
      ArrowUp: (current - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1
    };

    if (event.key === "Tab") {
      setOpen(false);

      return;
    }

    const target = targets[event.key];

    if (target === undefined || items.length === 0) {
      return;
    }

    event.preventDefault();
    items[target].focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={clsx(appearance === "button" ? ui["button"] : ui["icon-button"], styles["trigger"], styles[appearance], phoneOnly && styles["phone-only"])}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => open ? close() : openMenu(false)}
        onKeyDown={handleTriggerKeyDown}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      <div
        ref={popupRef}
        id={menuId}
        className={styles["menu"]}
        popover="manual"
        role="menu"
        aria-label={label}
        onKeyDown={handleMenuKeyDown}
      >
        {open && (
          <MenuContext
            value={{
              close
            }}
          >
            {children}
          </MenuContext>
        )}
      </div>
    </>
  );
}

// Phone-only entries are hidden on wider screens and cannot take focus there.
function menuItems(menu: HTMLElement | null) {
  const items = Array.from(menu?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []);

  return items.filter(item => item.ownerDocument.defaultView?.getComputedStyle(item).display !== "none");
}

/** A menu entry that runs an action after the menu has closed. */
export function MenuItem({
  icon,
  phoneOnly = false,
  danger = false,
  disabled = false,
  onSelect,
  children
}: ItemProps & {
  onSelect: () => void;
}) {
  const { close } = useContext(MenuContext);

  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={clsx(styles["item"], danger && styles["danger"], phoneOnly && styles["phone-only"])}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** A menu entry that navigates to another view. */
export function MenuLink({
  icon,
  href,
  children
}: Omit<ItemProps, "danger" | "disabled" | "phoneOnly"> & {
  href: string;
}) {
  const { close } = useContext(MenuContext);

  return (
    <Link
      role="menuitem"
      tabIndex={-1}
      className={styles["item"]}
      href={href}
      onClick={close}
    >
      {icon}
      {children}
    </Link>
  );
}
