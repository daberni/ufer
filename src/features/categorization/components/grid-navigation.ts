const rowTolerance = 4;

function center(rect: DOMRect) {
  return rect.left + rect.width / 2;
}

function verticalNeighbor(options: HTMLElement[], index: number, direction: 1 | -1) {
  const current = options[index].getBoundingClientRect();
  const rows = options.map(option => option.getBoundingClientRect());
  const candidates = rows
    .map((rect, candidateIndex) => ({
      rect,
      candidateIndex
    }))
    .filter(({ rect }) => (rect.top - current.top) * direction > rowTolerance);

  if (candidates.length === 0) {
    return index;
  }

  const nearestTop = direction === 1 ? Math.min(...candidates.map(({ rect }) => rect.top)) : Math.max(...candidates.map(({ rect }) => rect.top));
  const row = candidates.filter(({ rect }) => Math.abs(rect.top - nearestTop) <= rowTolerance);
  const closest = row.reduce((best, candidate) => {
    const distance = Math.abs(center(candidate.rect) - center(current));
    const bestDistance = Math.abs(center(best.rect) - center(current));

    return distance < bestDistance ? candidate : best;
  });

  return closest.candidateIndex;
}

/**
 * The option an arrow, Home or End key moves to in a wrapped grid of options. Up and Down use the rendered layout, so the grid may change its column count
 * or contain group headings. Returns null for other keys.
 */
export function gridNeighbor(options: HTMLElement[], index: number, key: string) {
  const last = options.length - 1;

  switch (key) {
    case "ArrowRight":
      return Math.min(index + 1, last);
    case "ArrowLeft":
      return Math.max(index - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowDown":
      return verticalNeighbor(options, index, 1);
    case "ArrowUp":
      return verticalNeighbor(options, index, -1);
    default:
      return null;
  }
}
