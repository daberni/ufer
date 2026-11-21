import type { AccountKind } from "@/features/accounts/account-kinds";
import type { CategoryIconKey } from "@/features/categorization/category-icons";

/** Every row the demo seed owns has an ID with this prefix; re-running the seed replaces exactly these rows. */
export const demoIdPrefix = "demo-";

/** Provider reference prefix of seeded transactions, distinct from bank (`bank:`) and CSV references. */
export const demoReferencePrefix = "demo:";

export type DemoAccountKey = "checking" | "savings" | "creditCard" | "investment" | "property" | "loan";

export type DemoAccountDefinition = {
  id: string;
  name: string;
  kind: AccountKind;
};

export const demoAccounts: Record<DemoAccountKey, DemoAccountDefinition> = {
  checking: {
    id: "demo-checking",
    name: "Everyday account",
    kind: "checking"
  },
  savings: {
    id: "demo-savings",
    name: "Emergency fund",
    kind: "savings"
  },
  creditCard: {
    id: "demo-credit-card",
    name: "Travel credit card",
    kind: "credit_card"
  },
  investment: {
    id: "demo-investment",
    name: "ETF portfolio",
    kind: "investment"
  },
  property: {
    id: "demo-property",
    name: "Rental flat, Linden Street",
    kind: "property"
  },
  loan: {
    id: "demo-loan",
    name: "Mortgage, rental flat",
    kind: "loan"
  }
};

export type DemoCategory = {
  id: string;
  name: string;
  color: string;
  icon: CategoryIconKey;
};

/** Categories the seed adds next to the built-in ones (groceries, home, transport, leisure, income, transfer, fees). */
export const demoCategories: DemoCategory[] = [{
  id: "demo-dining",
  name: "Dining",
  color: "#d08a4f",
  icon: "dining"
}, {
  id: "demo-utilities",
  name: "Utilities",
  color: "#7d8a3a",
  icon: "utilities"
}, {
  id: "demo-insurance",
  name: "Insurance",
  color: "#4f8f9a",
  icon: "other"
}, {
  id: "demo-subscriptions",
  name: "Subscriptions",
  color: "#a46aa0",
  icon: "entertainment"
}, {
  id: "demo-health",
  name: "Health",
  color: "#c0605f",
  icon: "health"
}, {
  id: "demo-shopping",
  name: "Shopping",
  color: "#9a7b5a",
  icon: "shopping"
}, {
  id: "demo-travel",
  name: "Travel",
  color: "#3f87b5",
  icon: "travel"
}, {
  id: "demo-gifts",
  name: "Gifts & donations",
  color: "#d0708f",
  icon: "gifts"
}];

export type DemoRule = {
  id: string;
  name: string;
  pattern: string;
  mode: "keyword" | "regex";
  categoryId: string;
  priority: number;
  enabled: boolean;
};

/** Ordered by priority; earlier rules win, so gift and travel rules precede the shop and restaurant rules they overlap with. */
export const demoRules: DemoRule[] = [{
  id: "demo-rule-salary",
  name: "Salary and bonuses",
  pattern: "Alder & Finch Engineering",
  mode: "keyword",
  categoryId: "income",
  priority: 10,
  enabled: true
}, {
  id: "demo-rule-rental-income",
  name: "Rental income, flat 5",
  pattern: "Tenant Flat 5",
  mode: "keyword",
  categoryId: "income",
  priority: 12,
  enabled: true
}, {
  id: "demo-rule-interest-dividends",
  name: "Interest and dividends",
  pattern: "interest credit|dividend",
  mode: "regex",
  categoryId: "income",
  priority: 14,
  enabled: true
}, {
  id: "demo-rule-gifts",
  name: "Gifts and donations",
  pattern: "gift|Community Food Bank",
  mode: "regex",
  categoryId: "demo-gifts",
  priority: 20,
  enabled: true
}, {
  id: "demo-rule-travel",
  name: "Trips and payments abroad",
  pattern: "SkyHarbor|Seaside Apartments|Alpine Ridge|Edelweiss Lodge|Canal View Hotel|payment abroad",
  mode: "regex",
  categoryId: "demo-travel",
  priority: 25,
  enabled: true
}, {
  id: "demo-rule-fees-taxes",
  name: "Bank fees and taxes",
  pattern: "\\bfees?\\b|Tax Office",
  mode: "regex",
  categoryId: "fees",
  priority: 28,
  enabled: true
}, {
  id: "demo-rule-mortgage-interest",
  name: "Mortgage interest",
  pattern: "Mortgage interest",
  mode: "keyword",
  categoryId: "home",
  priority: 30,
  enabled: true
}, {
  id: "demo-rule-housing",
  name: "Rent and home",
  pattern: "Linden Court|Owners' Association|Brightfix|Toolbox Hardware",
  mode: "regex",
  categoryId: "home",
  priority: 32,
  enabled: true
}, {
  id: "demo-rule-utilities",
  name: "Energy, internet and phone",
  pattern: "Brightline Energy|Fibrenet|Lumen Mobile",
  mode: "regex",
  categoryId: "demo-utilities",
  priority: 40,
  enabled: true
}, {
  id: "demo-rule-insurance",
  name: "Insurance",
  pattern: "Shieldwell|Guardian Mutual",
  mode: "regex",
  categoryId: "demo-insurance",
  priority: 42,
  enabled: true
}, {
  id: "demo-rule-subscriptions",
  name: "Streaming, cloud and news",
  pattern: "Streamflix|Tunewave|CloudVault|Daily Ledger",
  mode: "regex",
  categoryId: "demo-subscriptions",
  priority: 44,
  enabled: true
}, {
  id: "demo-rule-groceries",
  name: "Supermarkets and bakeries",
  pattern: "Greenleaf Market|Daily Basket|Golden Crust|Farmers Market",
  mode: "regex",
  categoryId: "groceries",
  priority: 50,
  enabled: true
}, {
  id: "demo-rule-transport",
  name: "Public transport and mobility",
  pattern: "City Transit|National Rail|ShareDrive|Bike Hub|CityCab",
  mode: "regex",
  categoryId: "transport",
  priority: 52,
  enabled: true
}, {
  id: "demo-rule-dining",
  name: "Restaurants, cafés and delivery",
  pattern: "Trattoria|Noodle Bar|Corner Café|Burger Dock|Green Bowl|Brewery|Staff canteen|QuickFork|Winter Market",
  mode: "regex",
  categoryId: "demo-dining",
  priority: 60,
  enabled: true
}, {
  id: "demo-rule-health",
  name: "Pharmacy, dentist and optician",
  pattern: "Pharmacy|Smilewell|Clearview",
  mode: "regex",
  categoryId: "demo-health",
  priority: 62,
  enabled: true
}, {
  id: "demo-rule-shopping",
  name: "Shops and online orders",
  pattern: "Parcelbay|Hometown Department Store|Trailhead Outdoor|Northside Electronics|Nordhaus Furniture|Appliance Center",
  mode: "regex",
  categoryId: "demo-shopping",
  priority: 70,
  enabled: true
}, {
  id: "demo-rule-leisure",
  name: "Culture, sport and going out",
  pattern: "Cinema|Bookshop|Concert Hall|Climbing Hall|Lido|Peak Form Gym",
  mode: "regex",
  categoryId: "leisure",
  priority: 72,
  enabled: true
}, {
  id: "demo-rule-online-wallet",
  name: "Online wallet payments (paused)",
  pattern: "PAYPAL",
  mode: "keyword",
  categoryId: "demo-shopping",
  priority: 90,
  enabled: false
}];
