import type { AccountKind } from "../account-kinds";

export type AccountTypeGroup = {
  id: string;
  title: string;
  description: string;
  kinds: AccountKind[];
};

export type AccountTypeCopy = {
  description: string;
  namePlaceholder: string;
  institutionLabel: string;
  institutionPlaceholder: string;
  balanceLabel: string;
  balancePlaceholder: string;
  hint: string;
};

export const accountTypeGroups: AccountTypeGroup[] = [{
  id: "bank-accounts",
  title: "Bank accounts",
  description: "Money you can spend or have set aside",
  kinds: ["checking", "savings"]
}, {
  id: "investments",
  title: "Investments & property",
  description: "Things you own whose value changes",
  kinds: ["investment", "property"]
}, {
  id: "debts",
  title: "Debts",
  description: "Money you owe",
  kinds: ["credit_card", "loan"]
}];

export const accountTypeCopy: Record<AccountKind, AccountTypeCopy> = {
  checking: {
    description: "Everyday payments, salary and bills",
    namePlaceholder: "e.g. Everyday account",
    institutionLabel: "Bank",
    institutionPlaceholder: "e.g. Example Bank",
    balanceLabel: "Current balance",
    balancePlaceholder: "0.00",
    hint: "Use a decimal point. Enter an overdrawn balance as a negative number."
  },
  savings: {
    description: "Money set aside or deposited for later",
    namePlaceholder: "e.g. Emergency fund",
    institutionLabel: "Bank",
    institutionPlaceholder: "e.g. Example Bank",
    balanceLabel: "Current balance",
    balancePlaceholder: "0.00",
    hint: "Use a decimal point."
  },
  investment: {
    description: "Securities, funds or pension savings",
    namePlaceholder: "e.g. Investment portfolio",
    institutionLabel: "Provider",
    institutionPlaceholder: "e.g. Example Broker",
    balanceLabel: "Current value",
    balancePlaceholder: "0.00",
    hint: "Enter the value of the holdings only and track settlement cash as a separate current account, so it is not counted twice. Use a decimal point."
  },
  property: {
    description: "Home, apartment or land",
    namePlaceholder: "e.g. Apartment",
    institutionLabel: "Location",
    institutionPlaceholder: "e.g. City or district",
    balanceLabel: "Estimated value",
    balancePlaceholder: "0.00",
    hint: "Enter your own estimate of the current market value. Use a decimal point."
  },
  credit_card: {
    description: "Card spending you pay back later",
    namePlaceholder: "e.g. Travel card",
    institutionLabel: "Card issuer",
    institutionPlaceholder: "e.g. Example Bank",
    balanceLabel: "Outstanding balance",
    balancePlaceholder: "-0.00",
    hint: "Enter the amount you currently owe as a negative number, e.g. -350.00."
  },
  loan: {
    description: "Mortgage, car or personal loan",
    namePlaceholder: "e.g. Mortgage",
    institutionLabel: "Lender",
    institutionPlaceholder: "e.g. Example Bank",
    balanceLabel: "Amount still owed",
    balancePlaceholder: "-0.00",
    hint: "Enter the amount still owed as a negative number, e.g. -12000.00."
  }
};
