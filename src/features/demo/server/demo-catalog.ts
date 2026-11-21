import type { AccountKind } from "@/features/accounts/account-kinds";
import type { CategoryIconKey } from "@/features/categorization/category-icons";

/** Every row the demo seed owns has an ID with this prefix; re-running the seed replaces exactly these rows. */
export const demoIdPrefix = "demo-";

/** Provider reference prefix of seeded transactions, distinct from bank (`bank:`) and CSV references. */
export const demoReferencePrefix = "demo:";

export type DemoAccountKey = "checking" | "onlineChecking" | "joint" | "cash" | "savings" | "creditCard" | "investment" | "property" | "car" | "loan";

export type DemoConnectionKey = "riverside" | "meadow" | "harbor";

/** A simulated bank connection: shown as linked, but never synced, so the seed never contacts a provider. */
export type DemoConnection = {
  id: string;
  bankName: string;
  /** Days before the run date on which the authorization was granted; it stays valid for 180 days. */
  grantedDaysAgo: number;
};

export const demoConnections: Record<DemoConnectionKey, DemoConnection> = {
  riverside: {
    id: "demo-connection-riverside",
    bankName: "Riverside Bank",
    grantedDaysAgo: 64
  },
  meadow: {
    id: "demo-connection-meadow",
    bankName: "Meadow Direct Bank",
    grantedDaysAgo: 23
  },
  harbor: {
    id: "demo-connection-harbor",
    bankName: "Harbor Card Services",
    grantedDaysAgo: 112
  }
};

export type DemoAccountDefinition = {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  /** Bank-connected accounts carry a simulated connection and an invented IBAN with a valid check digit. */
  bank?: {
    connection: DemoConnectionKey;
    iban: string;
  };
};

export const demoAccounts: Record<DemoAccountKey, DemoAccountDefinition> = {
  checking: {
    id: "demo-checking",
    name: "Everyday account",
    institution: "Riverside Bank",
    kind: "checking",
    bank: {
      connection: "riverside",
      iban: "AT510001040217730501"
    }
  },
  onlineChecking: {
    id: "demo-online-checking",
    name: "Online current account",
    institution: "Meadow Direct Bank",
    kind: "checking",
    bank: {
      connection: "meadow",
      iban: "AT160002081450962210"
    }
  },
  joint: {
    id: "demo-joint",
    name: "Joint household account",
    institution: "Riverside Bank",
    kind: "checking",
    bank: {
      connection: "riverside",
      iban: "AT500001040217730519"
    }
  },
  cash: {
    id: "demo-cash",
    name: "Cash wallet",
    institution: "Cash",
    kind: "checking"
  },
  savings: {
    id: "demo-savings",
    name: "Emergency fund",
    institution: "Riverside Bank",
    kind: "savings",
    bank: {
      connection: "riverside",
      iban: "AT280001040217730527"
    }
  },
  creditCard: {
    id: "demo-credit-card",
    name: "Travel credit card",
    institution: "Harbor Card Services",
    kind: "credit_card",
    bank: {
      connection: "harbor",
      iban: "AT020003050093318840"
    }
  },
  investment: {
    id: "demo-investment",
    name: "ETF portfolio",
    institution: "Northwind Brokerage",
    kind: "investment"
  },
  property: {
    id: "demo-property",
    name: "Rental flat, Linden Street",
    institution: "Own valuation",
    kind: "property"
  },
  car: {
    id: "demo-car",
    name: "Family car",
    institution: "Own valuation",
    kind: "property"
  },
  loan: {
    id: "demo-loan",
    name: "Mortgage, rental flat",
    institution: "Riverside Bank",
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
  name: "Car, public transport and mobility",
  pattern: "City Transit|National Rail|ShareDrive|Bike Hub|CityCab|Fuelstop|Motorway Vignette|Autocare Garage",
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
