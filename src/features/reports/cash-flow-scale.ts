/** Where the shared zero line sits, as a fraction of the bar area's height from the top, and the amount that spans the whole height. */
export type CashFlowScale = {
  zero: number;
  extent: number;
};

type MonthFlows = {
  income: number;
  expenses: number;
};

/**
 * One y-axis for all months. Income is drawn upward and expenses downward from the zero line, so a negative flow (refunds exceeding spending, for example) points the other way. The bounds include every signed bar end and every net, so all bars and net points stay inside the plot.
 */
export function cashFlowScale(months: MonthFlows[]): CashFlowScale {
  const values = months.flatMap(month => [month.income, -month.expenses, month.income - month.expenses]);
  const up = Math.max(0, ...values);
  const down = Math.max(0, ...values.map(value => -value));
  const extent = up + down;

  if (extent === 0) {
    return {
      zero: 0.5,
      extent: 1
    };
  }

  return {
    zero: up / extent,
    extent
  };
}

/** Distance from the top of the bar area for a signed amount: positive above the zero line, negative below. */
export function scaleOffset(amount: number, scale: CashFlowScale) {
  return scale.zero - amount / scale.extent;
}

/** Top and height of a bar from the zero line to a signed amount, as fractions of the bar area's height. */
export function barSpan(amount: number, scale: CashFlowScale) {
  const end = scaleOffset(amount, scale);

  return {
    top: Math.min(scale.zero, end),
    height: Math.abs(amount) / scale.extent
  };
}
