// Placement of a popover anchored to a control, in the coordinates of the layout viewport that position: fixed uses.

export type Box = {
  top: number;
  bottom: number;
  left: number;
};

export type Size = {
  width: number;
  height: number;
};

/** The visible part of the page, which shrinks while an on-screen keyboard is shown. */
export type VisibleArea = Size & {
  top: number;
  left: number;
};

export type PopoverPlacement = {
  top: number;
  left: number;
  maxHeight: number;
};

const anchorGap = 6;
const viewportMargin = 16;

/** Opens below the anchor unless the popover fits better above it, and keeps it inside the visible area's side margins. */
export function popoverPlacement(anchor: Box, popover: Size, visible: VisibleArea): PopoverPlacement {
  const visibleBottom = visible.top + visible.height;
  const spaceBelow = visibleBottom - anchor.bottom - anchorGap - viewportMargin;
  const spaceAbove = anchor.top - visible.top - anchorGap - viewportMargin;
  const opensBelow = popover.height <= spaceBelow || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(opensBelow ? spaceBelow : spaceAbove, 0);
  const height = Math.min(popover.height, maxHeight);
  const top = opensBelow ? anchor.bottom + anchorGap : anchor.top - anchorGap - height;
  const rightLimit = visible.left + visible.width - viewportMargin - popover.width;
  const left = Math.max(Math.min(anchor.left, rightLimit), visible.left + viewportMargin);

  return {
    top,
    left,
    maxHeight
  };
}

/** The widest a popover may be: the visible width without its side margins. */
export function popoverMaxWidth(visible: VisibleArea) {
  return Math.max(visible.width - 2 * viewportMargin, 0);
}

/** The visual viewport excludes an on-screen keyboard, which window.innerHeight still includes on phones. */
export function visibleArea(): VisibleArea {
  const viewport = window.visualViewport;

  if (!viewport) {
    return {
      top: 0,
      left: 0,
      width: document.documentElement.clientWidth,
      height: window.innerHeight
    };
  }

  return {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    width: viewport.width,
    height: viewport.height
  };
}
