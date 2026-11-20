"use client";

import { Select } from "@/components/ui/select";
import { setCurrency, useCurrency } from "@/client/use-app-url";
import { showsCurrencySelect } from "@/features/accounts/queries";

type Props = {
  /** The currencies in use and the selected one; until they load, no choice is offered. */
  currencies: string[];
  /** Shows only the code, for a badge-sized choice; the options still name the accounts they show. */
  compact?: boolean;
  className?: string;
};

/** Picks which accounts' figures are shown, without conversion; with one currency in use there is nothing to choose and nothing is rendered. */
export function CurrencyChoice({
  currencies,
  compact = false,
  className
}: Props) {
  const currency = useCurrency();

  if (!showsCurrencySelect(currencies)) {
    return null;
  }

  return (
    <Select
      variant="bare"
      className={className}
      aria-label="Accounts shown by currency"
      title={compact ? "Accounts shown by currency" : undefined}
      value={currency}
      onChange={event => setCurrency(event.target.value)}
    >
      {currencies.map(value => <option key={value} value={value}>{compact ? value : `${value} accounts`}</option>)}
    </Select>
  );
}
