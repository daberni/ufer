"use client";

import { useRef, useState, type DragEvent } from "react";

// Text, links and in-page reordering carry other types; only a drag of files from the system offers "Files".
function carriesFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Drag-and-drop handlers for a file drop target. Only drags carrying files highlight it or are accepted, and the highlight counts nested enter/leave events so it stays on while the pointer crosses child elements. The innermost target owns a file drag, so an enclosing one neither highlights nor starts a second import.
 */
export function useFileDrag({
  disabled,
  onFile
}: {
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  function leaveAll() {
    depth.current = 0;
    setDragging(false);
  }

  const handlers = {
    onDragEnter(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      depth.current += 1;
      setDragging(!disabled);
    },
    onDragOver(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }

      // Accepting the drag over every child makes the area a drop target; a disabled one still keeps the browser from opening the file.
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    onDragLeave(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }

      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);

      if (depth.current === 0) {
        setDragging(false);
      }
    },
    onDrop(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      leaveAll();

      const file = event.dataTransfer.files[0];

      if (file && !disabled) {
        onFile(file);
      }
    }
  };

  return {
    dragging,
    handlers
  };
}
