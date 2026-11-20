"use client";

import { KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent, type Modifier, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { settle } from "@/client/settle";
import type { Failure } from "@/client/api";
import { useReorderRules } from "@/features/categorization/mutations";
import type { Rule } from "@/features/categorization/types";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

/** Rules only move up and down, so the dragged row stays aligned with the list. */
export const verticalOnly: Modifier = ({ transform }) => ({
  ...transform,
  x: 0
});

function ruleAnnouncements(rules: Rule[], locale: string): Announcements {
  const name = (id: UniqueIdentifier) => rules.find(rule => rule.id === id)?.name ?? "Rule";
  const position = (id: UniqueIdentifier | undefined) => formatCount(rules.findIndex(rule => rule.id === id) + 1, locale);
  const total = formatCount(rules.length, locale);

  return {
    onDragStart: event => `Picked up ${name(event.active.id)} at position ${position(event.active.id)} of ${total}.`,
    onDragOver: event => event.over ? `${name(event.active.id)} is at position ${position(event.over.id)} of ${total}.` : `${name(event.active.id)} is outside the list.`,
    onDragEnd: event => event.over ? `${name(event.active.id)} dropped at position ${position(event.over.id)} of ${total}.` : `${name(event.active.id)} returned to its position.`,
    onDragCancel: event => `Moving ${name(event.active.id)} was cancelled; it returned to position ${position(event.active.id)}.`
  };
}

export const reorderInstructions = {
  draggable: "To move a rule, press Space or Enter on its handle, use the arrow keys to choose its position, then press Space or Enter again to drop it or Escape to cancel. Rules match from the top; existing transactions change only when you apply the rules."
};

/**
 * Sorting through dnd-kit: a pointer sensor for mouse, pen and touch on the drag handle, and a keyboard sensor with screen-reader announcements. A drop saves the new order; a failed save restores the previous order and reports the failure next to the list.
 */
export function useRuleReorder(rules: Rule[]) {
  const locale = useLocale();
  const reorder = useReorderRules();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draggedId, setDraggedId] = useState<UniqueIdentifier | null>(null);
  // The dropped order, rendered in the same update as the drop so the overlay animates into the new slot; query updates reach the list a tick later.
  const [dropped, setDropped] = useState<Rule[] | null>(null);
  const saves = useRef(0);
  const shown = dropped ?? rules;
  const sensors = useSensors(
    // A short distance keeps a tap on the handle from starting a drag.
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  async function onDragEnd(event: DragEndEvent) {
    const {
      active,
      over
    } = event;

    setDraggedId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const from = shown.findIndex(rule => rule.id === active.id);
    const to = shown.findIndex(rule => rule.id === over.id);

    if (from < 0 || to < 0) {
      return;
    }

    const order = arrayMove(shown, from, to);
    const save = ++saves.current;

    setFailure(null);
    setDropped(order);
    const result = await settle(reorder.save(order));

    // Only the latest drop decides what the list and its message show; an older save's outcome is superseded.
    if (save !== saves.current) {
      return;
    }

    // By now the query holds the saved order, or the restored one after a failure.
    setDropped(null);
    setFailure(result.ok ? null : result.failure);
  }

  return {
    rules: shown,
    sensors,
    dragged: shown.find(rule => rule.id === draggedId) ?? null,
    onDragStart: (event: DragStartEvent) => setDraggedId(event.active.id),
    onDragCancel: () => setDraggedId(null),
    announcements: ruleAnnouncements(shown, locale),
    failure,
    dismissFailure: () => setFailure(null),
    onDragEnd
  };
}
