/** The preferred gap between ordered priorities, which leaves room to place a rule between two others in the editor. */
const priorityStep = 10;

const highestPriority = 10000;

/** Distinct, ascending priorities for rules in list order, within the range the rule editor accepts. */
export function orderedPriorities(count: number) {
  const step = Math.max(1, Math.min(priorityStep, Math.floor(highestPriority / Math.max(count, 1))));

  return Array.from({
    length: count
  }, (_, index) => (index + 1) * step);
}

/** The priority that places a new rule after every stored rule, as far as the allowed range permits. */
export function endPriority(rules: {
  priority: number;
}[]) {
  const last = Math.max(0, ...rules.map(rule => rule.priority));

  return Math.min(highestPriority, last + priorityStep);
}

/** The rules with the priorities that saving this order stores, so the list shows them before the save completes. */
export function withOrderedPriorities<T extends {
  priority: number;
}>(rules: T[]) {
  const priorities = orderedPriorities(rules.length);

  return rules.map((rule, index) => ({
    ...rule,
    priority: priorities[index]
  }));
}
