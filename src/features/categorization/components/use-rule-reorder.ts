"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { settle } from "@/client/settle";
import { useReorderRules } from "@/features/categorization/mutations";
import { moveItem } from "@/features/categorization/rule-order";
import type { Rule } from "@/features/categorization/types";

type Drag = {
  id: string;
  pointerId: number;
  order: Rule[];
};

/** Distance from the viewport edge at which dragging scrolls the page, since the handle blocks touch scrolling. */
const scrollEdge = 64;

const scrollStep = 12;

function rowCenters(list: HTMLElement, draggedId: string) {
  return [...list.querySelectorAll<HTMLElement>("[data-rule-id]")].filter(row => row.dataset.ruleId !== draggedId).map(row => {
    const bounds = row.getBoundingClientRect();

    return bounds.top + bounds.height / 2;
  });
}

function keyboardTarget(key: string, index: number, count: number) {
  if (key === "ArrowUp") {
    return Math.max(0, index - 1);
  }

  if (key === "ArrowDown") {
    return Math.min(count - 1, index + 1);
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return count - 1;
  }

  return null;
}

function sameOrder(first: Rule[], second: Rule[]) {
  return first.length === second.length && first.every((rule, index) => rule.id === second[index].id);
}

/**
 * Reorders rules by dragging a handle with a mouse, pen or touch, or with the arrow, Home and End keys on the focused handle. A pointer drag is saved once on release; each key press is saved immediately and announced.
 */
export function useRuleReorder(rules: Rule[], listRef: RefObject<HTMLOListElement | null>, reportFailure: (message: string, traceId?: string) => void) {
  const reorder = useReorderRules();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The latest order chosen by keyboard, shown until its save settles, so quick key presses build on each other.
  const [chosen, setChosen] = useState<Rule[] | null>(null);
  const saves = useRef(0);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  // Moving a focused row can drop focus in some browsers, so the moved handle is focused again after rendering.
  const refocus = useRef<string | null>(null);
  const shown = drag?.order ?? chosen ?? rules;

  useLayoutEffect(() => {
    if (refocus.current === null) {
      return;
    }

    const handle = handles.current.get(refocus.current);

    refocus.current = null;

    if (handle && document.activeElement !== handle) {
      handle.focus();
    }
  });

  async function save(order: Rule[], moved: Rule) {
    const position = order.findIndex(rule => rule.id === moved.id) + 1;

    const save = ++saves.current;

    setChosen(order);
    setAnnouncement(`${moved.name} moved to position ${position} of ${order.length}.`);
    const result = await settle(reorder.mutateAsync(order));

    if (save === saves.current) {
      setChosen(null);
    }

    if (!result.ok) {
      setAnnouncement("");
      reportFailure(`The rule order could not be saved: ${result.failure.message}`, result.failure.traceId);
    }
  }

  function handleRef(id: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) {
        handles.current.set(id, element);
      } else {
        handles.current.delete(id);
      }
    };
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, rule: Rule) {
    if (event.button !== 0 || shown.length < 2) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      id: rule.id,
      pointerId: event.pointerId,
      order: shown
    });
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const list = listRef.current;

    if (!drag || drag.pointerId !== event.pointerId || !list) {
      return;
    }

    if (event.clientY < scrollEdge) {
      window.scrollBy(0, -scrollStep);
    } else if (event.clientY > window.innerHeight - scrollEdge) {
      window.scrollBy(0, scrollStep);
    }

    const from = drag.order.findIndex(rule => rule.id === drag.id);
    const to = rowCenters(list, drag.id).filter(center => center < event.clientY).length;

    if (from !== to) {
      setDrag({
        ...drag,
        order: moveItem(drag.order, from, to)
      });
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const moved = drag.order.find(rule => rule.id === drag.id);

    setDrag(null);

    if (moved && !sameOrder(drag.order, chosen ?? rules)) {
      refocus.current = moved.id;
      void save(drag.order, moved);
    }
  }

  function onPointerCancel() {
    setDrag(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, rule: Rule) {
    const from = shown.findIndex(stored => stored.id === rule.id);
    const to = keyboardTarget(event.key, from, shown.length);

    if (to === null || drag) {
      return;
    }

    event.preventDefault();

    if (to === from) {
      return;
    }

    refocus.current = rule.id;
    void save(moveItem(shown, from, to), rule);
  }

  return {
    rules: shown,
    draggingId: drag?.id ?? null,
    announcement,
    handleProps: (rule: Rule) => ({
      ref: handleRef(rule.id),
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => onPointerDown(event, rule),
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, rule)
    })
  };
}
