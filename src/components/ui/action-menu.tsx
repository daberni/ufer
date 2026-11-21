"use client";

import ui from "./primitives.module.css";
import styles from "./action-menu.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismiss } from "./use-dismiss";

type MenuContext = {
  /** Closes the menu and returns focus to its button, so a dialog opened next restores focus there. */
  close: () => void;
};

const MenuContext = createContext<MenuContext>({
  close: () => undefined
});

type ItemProps = {
  icon?: ReactNode;
  /** Marks an action that removes data. */
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

/** A "…" button that opens a menu of rarely used actions; arrow keys, Home and End move between them and Escape or a press outside closes it. */
export function ActionMenu({
  label,
  children
}: {
  /** The button's accessible name, such as "Actions for Synthetic checking". */
  label: string;
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
        className={clsx(ui["icon-button"], styles["trigger"])}
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

function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []);
}

/** A menu entry that runs an action after the menu has closed. */
export function MenuItem({
  icon,
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
      className={clsx(styles["item"], danger && styles["danger"])}
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
}: Omit<ItemProps, "danger" | "disabled"> & {
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
