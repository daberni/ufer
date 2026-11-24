// The connection dialog's country and bank choice. A bank counts as chosen only after it was picked from the list, never because a search matches it.

import type { Bank, Connection } from "@/features/banking/types";

/** Countries with personal banks to connect; the dialog names them in the interface language with Intl.DisplayNames. */
export const bankCountries = [{
  code: "AT"
}, {
  code: "DE"
}, {
  code: "FI"
}, {
  code: "GB"
}, {
  code: "SE"
}] as const;

const fallbackCountry = "AT";

function isBankCountry(code: string) {
  return bankCountries.some(country => country.code === code);
}

/** The country most existing connections use, otherwise the region of the first browser language that has one, otherwise Austria. */
export function defaultBankCountry(connections: readonly Pick<Connection, "bank_country">[], languages: readonly string[]) {
  const counts = new Map<string, number>();

  for (const connection of connections) {
    if (isBankCountry(connection.bank_country)) {
      counts.set(connection.bank_country, (counts.get(connection.bank_country) ?? 0) + 1);
    }
  }

  const [mostConnected] = [...counts].sort((left, right) => right[1] - left[1]);

  if (mostConnected) {
    return mostConnected[0];
  }

  for (const language of languages) {
    const region = language.split("-").slice(1).find(part => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();

    if (region && isBankCountry(region)) {
      return region;
    }
  }

  return fallbackCountry;
}

export type BankSelection = {
  /** Null until a country is picked, so the default can follow the connections once they load. */
  country: string | null;
  /** The text in the bank field: a search, or the chosen bank's name. */
  query: string;
  /** Empty until a bank is chosen from the list. */
  bankName: string;
};

export type BankSelectionChange = {
  type: "country";
  country: string;
} | {
  type: "search";
  query: string;
} | {
  type: "choose";
  bankName: string;
};

export function changeBankSelection(selection: BankSelection, change: BankSelectionChange): BankSelection {
  switch (change.type) {
    case "country":
      return {
        country: change.country,
        query: "",
        bankName: ""
      };
    case "search":
      return {
        ...selection,
        query: change.query,
        bankName: ""
      };
    case "choose":
      return {
        ...selection,
        query: change.bankName,
        bankName: change.bankName
      };
  }
}

/** The directory as offered for choice: alphabetical, and a bank listed twice under the same name only once, since the name identifies it. */
export function directoryBanks(banks: readonly Bank[]) {
  const unique = new Map<string, Bank>();

  for (const bank of banks) {
    if (!unique.has(bank.name)) {
      unique.set(bank.name, bank);
    }
  }

  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** The bank to authorize: only a chosen bank that the field still shows and the loaded directory still offers. */
export function chosenBankName(selection: BankSelection, banks: readonly Bank[]) {
  const shown = selection.bankName !== "" && selection.query === selection.bankName;

  return shown && banks.some(bank => bank.name === selection.bankName) ? selection.bankName : "";
}
