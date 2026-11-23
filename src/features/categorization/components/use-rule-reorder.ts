"use client";

import { KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent, type Modifier, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { settle } from "@/client/settle";
import type { Failure } from "@/client/api";
import { useReorderRules } from "@/features/categorization/mutations";
import type { Rule } from "@/features/categorization/types";
import { useTranslations } from "next-intl";

/** Rules only move up and down, so the dragged row stays aligned with the list. */
export const verticalOnly: Modifier = ({ transform }) => ({
  ...transform,
  x: 0
});

function ruleAnnouncements(rules: Rule[], t: ReturnType<typeof useTranslations<"categorization.reorder">>): Announcements {
  const name = (id: UniqueIdentifier) => rules.find(rule => rule.id === id)?.name ?? t("unnamed");
  const position = (id: UniqueIdentifier | undefined) => rules.findIndex(rule => rule.id === id) + 1;
  const total = rules.length;

  return {
    onDragStart: event => t("pickedUp", {
      name: name(event.active.id),
      position: position(event.active.id),
      total
    }),
    onDragOver: event => event.over ? t("over", {
      name: name(event.active.id),
      position: position(event.over.id),
      total
    }) : t("outside", {
      name: name(event.active.id)
    }),
    onDragEnd: event => event.over ? t("dropped", {
      name: name(event.active.id),
      position: position(event.over.id),
      total
    }) : t("returned", {
      name: name(event.active.id)
    }),
    onDragCancel: event => t("cancelled", {
      name: name(event.active.id),
      position: position(event.active.id)
    })
  };
}

/**
 * Sorting through dnd-kit: a pointer sensor for mouse, pen and touch on the drag handle, and a keyboard sensor with screen-reader announcements. A drop saves the new order; a failed save restores the previous order and reports the failure next to the list.
 */
export function useRuleReorder(rules: Rule[]) {
  const t = useTranslations("categorization.reorder");
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
    announcements: ruleAnnouncements(shown, t),
    instructions: {
      draggable: t("instructions")
    },
    failure,
    dismissFailure: () => setFailure(null),
    onDragEnd
  };
}
