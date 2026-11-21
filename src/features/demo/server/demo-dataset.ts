import { Temporal } from "temporal-polyfill";
import type { Entry, ProviderDetails } from "@/features/transactions/server/transaction-entry";
import { demoAccounts, demoConnections, demoReferencePrefix, type DemoAccountDefinition, type DemoAccountKey, type DemoConnectionKey } from "./demo-catalog";
import { DemoRandom } from "./demo-random";

/** Length of the generated history; it always ends on the run date. */
export const demoHistoryMonths = 18;

export type DemoSnapshot = {
  date: string;
  amount: number;
};

export type DemoAccountData = DemoAccountDefinition & {
  /** The balance on the first day of the history, booked as the opening balance. */
  opening: DemoSnapshot;
  entries: Entry[];
  /** Market values recorded with Update balance; each books the difference to the transactions as an adjustment. */
  valuations: DemoSnapshot[];
  /** The balance on the run date; bank-connected accounts report it as their latest bank balance. */
  closing: DemoSnapshot;
};

/** A booking divided into category parts that add up to its amount, as a person does in the split dialog. */
export type DemoSplit = {
  accountId: string;
  reference: string;
  parts: {
    amount: number;
    categoryId: string;
    note: string;
  }[];
};

/** A simulated bank connection with the times it was granted and expires. */
export type DemoConnectionData = {
  id: string;
  bankName: string;
  grantedAt: string;
  validUntil: string;
};

/** A recorded sync run; the seed writes the history only and never runs a sync. */
export type DemoSyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: "SUCCESS" | "PARTIAL";
  insertedCount: number;
  error: string | null;
};

/** A transfer whose counterpart the seed creates on a manual account, as a person does in the edit dialog. */
export type DemoCreatedCounterpart = {
  sourceAccountId: string;
  sourceReference: string;
  accountId: string;
};

export type DemoDataset = {
  firstDate: string;
  runDate: string;
  accounts: DemoAccountData[];
  createdCounterparts: DemoCreatedCounterpart[];
  splits: DemoSplit[];
  connections: DemoConnectionData[];
  syncRuns: DemoSyncRun[];
  /** When the connected accounts were last synced: the latest recorded run. */
  lastSyncedAt: string;
};

type PlainDate = Temporal.PlainDate;

type PlainYearMonth = Temporal.PlainYearMonth;

// Balances in minor units on the first day of the history; the checking balance is derived from its cash flow.
const openingBalances: Record<DemoAccountKey, number> = {
  checking: 0,
  onlineChecking: 0,
  joint: 0,
  cash: 0,
  savings: 980000,
  creditCard: 0,
  investment: 1840000,
  property: 26800000,
  car: 2150000,
  loan: -17240000
};

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const restaurants = ["Trattoria Sole", "Noodle Bar Kaze", "Corner Café Linden", "Burger Dock", "Green Bowl Kitchen", "Old Town Brewery"];

const placesAbroad = ["Taverna Thalassa", "Marina Market", "Azure Ferry Lines", "Harbour Gelato", "Old Port Museum", "Beach Club Kalypso"];

const christmasShops = ["Toy Workshop", "Gift Box Studio", "Hometown Department Store", "Old Town Bookshop"];

// Rows no enabled rule matches, so the review queue is never empty. Each is placed this many days before the run date.
const unmatchedRows: {
  daysAgo: number;
  account: DemoAccountKey;
  amount: number;
  counterparty: string;
  description: string;
}[] = [{
  daysAgo: 2,
  account: "creditCard",
  amount: -780,
  counterparty: "SQ *MARKET STALL 0412",
  description: "Card payment"
}, {
  daysAgo: 9,
  account: "checking",
  amount: 6420,
  counterparty: "SEPA credit 7781-221",
  description: "Reimbursement"
}, {
  daysAgo: 33,
  account: "creditCard",
  amount: -2340,
  counterparty: "PAYPAL *ZX STORE",
  description: "Online payment 1029384"
}, {
  daysAgo: 61,
  account: "checking",
  amount: -360,
  counterparty: "POS 4471 KIOSK 22",
  description: "Debit card purchase"
}, {
  daysAgo: 118,
  account: "checking",
  amount: -15000,
  counterparty: "Transfer reference 88412-B",
  description: "Outgoing transfer"
}, {
  daysAgo: 187,
  account: "checking",
  amount: 4650,
  counterparty: "P2P wallet settlement",
  description: "Shared dinner"
}, {
  daysAgo: 255,
  account: "creditCard",
  amount: -3190,
  counterparty: "PAYPAL *LUMA PRINTS",
  description: "Online payment 2210457"
}, {
  daysAgo: 329,
  account: "checking",
  amount: -1800,
  counterparty: "Direct debit 55-0193",
  description: "Mandate 55-0193"
}, {
  daysAgo: 404,
  account: "creditCard",
  amount: -1200,
  counterparty: "SUMUP *POP-UP STAND",
  description: "Card payment"
}, {
  daysAgo: 468,
  account: "checking",
  amount: -250,
  counterparty: "Vending 0815",
  description: "Debit card purchase"
}];

function dayOf(month: PlainYearMonth, day: number) {
  return month.toPlainDate({
    day: Math.min(day, month.daysInMonth)
  });
}

/** Banks book scheduled payments that fall on a weekend on the following Monday. */
function businessDay(date: PlainDate) {
  if (date.dayOfWeek === 6) {
    return date.add({
      days: 2
    });
  }

  if (date.dayOfWeek === 7) {
    return date.add({
      days: 1
    });
  }

  return date;
}

function lastBusinessDay(month: PlainYearMonth) {
  let date = dayOf(month, 31);

  while (date.dayOfWeek > 5) {
    date = date.subtract({
      days: 1
    });
  }

  return date;
}

function monthLabel(month: PlainYearMonth) {
  return `${monthNames[month.month - 1]} ${month.year}`;
}

function quarterLabel(date: PlainDate) {
  return `Q${Math.ceil(date.month / 3)} ${date.year}`;
}

/** The latest occurrence of a calendar month at or before the given month, used for yearly changes such as a raise. */
function latestMonthOfYear(monthOfYear: number, notAfter: PlainYearMonth) {
  const year = notAfter.month >= monthOfYear ? notAfter.year : notAfter.year - 1;

  return Temporal.PlainYearMonth.from({
    year,
    month: monthOfYear
  });
}

function isBetween(date: PlainDate, first: PlainDate, last: PlainDate) {
  return Temporal.PlainDate.compare(date, first) >= 0 && Temporal.PlainDate.compare(date, last) <= 0;
}

class Ledger {
  readonly entries: Record<DemoAccountKey, Entry[]> = {
    checking: [],
    onlineChecking: [],
    joint: [],
    cash: [],
    savings: [],
    creditCard: [],
    investment: [],
    property: [],
    car: [],
    loan: []
  };

  readonly splits: DemoSplit[] = [];

  readonly openings = {
    ...openingBalances
  };

  /** Counterparts created on manual accounts; they count toward that account's balance but are not entries. */
  readonly createdCounterparts: {
    from: DemoAccountKey;
    to: DemoAccountKey;
    reference: string;
    date: string;
    amount: number;
  }[] = [];

  private sequence = 0;

  constructor(readonly firstDate: PlainDate, readonly runDate: PlainDate) {}

  covers(date: PlainDate) {
    return isBetween(date, this.firstDate, this.runDate);
  }

  /** Books an entry and returns its reference; dates outside the history and zero amounts are skipped. */
  book(account: DemoAccountKey, date: PlainDate, amount: number, counterparty: string, description: string, transfer = false, provider?: ProviderDetails) {
    if (!this.covers(date) || amount === 0) {
      return undefined;
    }

    this.sequence += 1;
    const reference = `${demoReferencePrefix}${String(this.sequence).padStart(5, "0")}`;

    this.entries[account].push({
      reference,
      date: date.toString(),
      amount,
      currency: "EUR",
      counterparty,
      description,
      transfer,
      provider
    });

    return reference;
  }

  /** Books both sides of a transfer between own accounts; the seed links them as one transfer, which keeps them out of income and expenses. */
  transfer(from: DemoAccountKey, to: DemoAccountKey, date: PlainDate, amount: number, description: string) {
    this.book(from, date, -amount, demoAccounts[to].name, description, true);
    this.book(to, date, amount, demoAccounts[from].name, description, true);
  }

  /** Books the outgoing side of a transfer to a manual account; the seed creates the incoming side there and links both. */
  transferToManual(from: DemoAccountKey, to: DemoAccountKey, date: PlainDate, amount: number, description: string) {
    const reference = this.book(from, date, -amount, demoAccounts[to].name, description, true);

    if (reference) {
      this.createdCounterparts.push({
        from,
        to,
        reference,
        date: date.toString(),
        amount
      });
    }
  }

  /** Books an expense divided into category parts; the booking's amount is the sum of its parts. */
  bookSplit(account: DemoAccountKey, date: PlainDate, counterparty: string, description: string, parts: DemoSplit["parts"]) {
    const amount = parts.reduce((total, part) => total + part.amount, 0);
    const reference = this.book(account, date, amount, counterparty, description);

    if (reference) {
      this.splits.push({
        accountId: demoAccounts[account].id,
        reference,
        parts
      });
    }
  }

  balanceAt(account: DemoAccountKey, date: PlainDate) {
    const last = date.toString();
    const created = this.createdCounterparts.filter(item => item.to === account && item.date <= last).reduce((total, item) => total + item.amount, 0);

    return this.entries[account].filter(entry => entry.date <= last).reduce((total, entry) => total + entry.amount, this.openings[account] + created);
  }
}

type MonthContext = {
  ledger: Ledger;
  random: DemoRandom;
  month: PlainYearMonth;
  runMonth: PlainYearMonth;
};

function bookIncome({
  ledger,
  random,
  month,
  runMonth
}: MonthContext) {
  const raise = latestMonthOfYear(3, runMonth);
  const salary = Temporal.PlainYearMonth.compare(month, raise) >= 0 ? 429875 : 418240;
  // Paid at the start of the month it covers, so the current month on the overview already includes it.
  const payday = businessDay(dayOf(month, 1));
  const rentDay = businessDay(dayOf(month, random.chance(0.08) ? 9 : 3));

  ledger.book("checking", payday, salary, "Alder & Finch Engineering Ltd", `Salary ${monthLabel(month)}`);

  if (month.month === 6) {
    ledger.book("checking", payday, 241000, "Alder & Finch Engineering Ltd", `Holiday bonus ${month.year}`);
  }

  if (month.month === 11) {
    ledger.book("checking", payday, 241000, "Alder & Finch Engineering Ltd", `Christmas bonus ${month.year}`);
  }

  ledger.book("checking", rentDay, 76000, "Tenant Flat 5 Linden Street", `Rent ${monthLabel(month)} incl. operating costs`);
}

function bookHousing({
  ledger,
  random,
  month,
  runMonth
}: MonthContext) {
  const indexation = latestMonthOfYear(4, runMonth);
  const rent = Temporal.PlainYearMonth.compare(month, indexation) >= 0 ? 121500 : 118000;

  ledger.book("checking", businessDay(dayOf(month, 1)), -rent, "Linden Court Property Management", `Rent ${monthLabel(month)}, apartment 3/12`);
  ledger.book("checking", businessDay(dayOf(month, 5)), -21200, "Linden Street 14 Owners' Association", "Reserve fund and operating costs, flat 5");
  ledger.transfer("checking", "loan", businessDay(dayOf(month, 25)), 89000, "Mortgage instalment, loan 7741");

  if (random.chance(0.12)) {
    ledger.book("checking", dayOf(month, random.integer(6, 26)), -random.amount(9.5, 64), "Toolbox Hardware", "Debit card purchase");
  }
}

function bookContracts({
  ledger,
  month,
  runMonth
}: MonthContext) {
  const quarterly = month.month % 3 === 1;
  const streamingPriceIncrease = runMonth.subtract({
    months: 7
  });
  const streamingPrice = Temporal.PlainYearMonth.compare(month, streamingPriceIncrease) >= 0 ? 1549 : 1399;

  ledger.book("checking", businessDay(dayOf(month, 1)), -4280, "Guardian Mutual", "Supplementary health insurance");
  ledger.book("checking", businessDay(dayOf(month, 1)), -3650, "City Transit", "Annual pass, monthly instalment");
  ledger.book("checking", businessDay(dayOf(month, 3)), -3990, "Peak Form Gym", "Membership fee");
  ledger.book("joint", businessDay(dayOf(month, 8)), -3990, "Fibrenet Broadband", "Internet 250 Mbit/s");
  ledger.book("checking", businessDay(dayOf(month, 10)), -1500, "Community Food Bank", "Monthly donation");
  ledger.book("joint", businessDay(dayOf(month, 15)), -8400, "Brightline Energy", "Electricity instalment, customer 40-1187");
  ledger.book("checking", businessDay(dayOf(month, 1)), -4870, "Shieldwell Insurance", "Car insurance, policy KFZ-7310");
  ledger.book("checking", businessDay(dayOf(month, 20)), -1990, "Lumen Mobile", "Mobile plan");
  ledger.book("creditCard", dayOf(month, 7), -streamingPrice, "Streamflix", "Streaming subscription");
  ledger.book("creditCard", dayOf(month, 12), -1099, "Tunewave Music", "Music subscription");
  ledger.book("creditCard", dayOf(month, 22), -299, "CloudVault Storage", "Cloud storage 200 GB");

  if (quarterly) {
    ledger.book("checking", businessDay(dayOf(month, 2)), -5430, "Shieldwell Insurance", "Household insurance, policy HH-2231");
  }

  if (month.month % 2 === 1) {
    ledger.book("checking", businessDay(dayOf(month, 10)), -4560, "Public Broadcasting Fee Service", "Broadcasting fee, two months");
  }

  if (month.month % 3 === 0) {
    ledger.book("checking", lastBusinessDay(month), -750, "Riverside Bank", `Account maintenance fee ${quarterLabel(dayOf(month, 1))}`);
  }
}

function bookYearlyItems({
  ledger,
  month
}: MonthContext) {
  const previousYear = month.year - 1;

  switch (month.month) {
    case 1:
      ledger.book("checking", businessDay(dayOf(month, 15)), -21240, "Shieldwell Insurance", "Landlord insurance, flat 5");
      break;
    case 2:
      ledger.book("creditCard", dayOf(month, 3), -11900, "Daily Ledger", "Digital newspaper, annual subscription");
      ledger.book("checking", businessDay(dayOf(month, 15)), -9620, "City Tax Office", `Property tax ${month.year}, flat 5`);
      break;
    case 3:
      if (month.year % 2 === 0) {
        ledger.book("checking", businessDay(dayOf(month, 20)), 5820, "Brightline Energy", `Annual settlement ${previousYear}, credit`);
      } else {
        ledger.book("checking", businessDay(dayOf(month, 20)), -14630, "Brightline Energy", `Annual settlement ${previousYear}, back payment`);
      }

      break;
    case 4:
      ledger.book("checking", dayOf(month, 8), -9500, "Smilewell Dental Practice", "Check-up and cleaning");
      ledger.book("checking", dayOf(month, 16), -8650, "Bike Hub", "Bicycle service and new tyres");
      break;
    case 5:
      ledger.book("creditCard", dayOf(month, 1), -4800, "Harbor Card Services", "Annual card fee");
      ledger.book("checking", businessDay(dayOf(month, 22)), 61240, "Tax Office", `Income tax assessment ${previousYear}, refund`);
      break;
    case 6:
      ledger.book("checking", businessDay(dayOf(month, 12)), 12460, "Linden Court Property Management", `Operating costs settlement ${previousYear}, credit`);
      break;
    case 9:
      ledger.book("checking", businessDay(dayOf(month, 1)), -8900, "Shieldwell Insurance", "Personal liability insurance");
      ledger.book("checking", dayOf(month, 18), -41860, "Autocare Garage", "Annual car service and inspection");
      break;
    case 12:
      ledger.book("onlineChecking", dayOf(month, 6), -10340, "Motorway Vignette Shop", `Annual motorway vignette ${month.year + 1}`);
      break;
    case 10:
      ledger.book("checking", dayOf(month, 14), -9500, "Smilewell Dental Practice", "Check-up and cleaning");
      break;
  }
}

function bookSavings({
  ledger,
  month
}: MonthContext) {
  ledger.transfer("checking", "savings", businessDay(dayOf(month, 2)), 35000, "Standing order, emergency fund");
  ledger.transfer("checking", "investment", businessDay(dayOf(month, 5)), 30000, "Savings plan, Global Equity ETF");
  ledger.transfer("checking", "joint", businessDay(dayOf(month, 1)), 66000, "Household budget contribution");
  ledger.transfer("checking", "onlineChecking", businessDay(dayOf(month, 2)), 26000, "Monthly allowance");
  // A transfer to an account not tracked in Ufer: it has no counterpart.
  ledger.book("checking", businessDay(dayOf(month, 3)), -5000, "Junior savings account", "Children's savings plan", true);
  ledger.transfer("checking", "cash", businessDay(dayOf(month, 9)), month.month === 12 ? 12000 : 8000, "ATM withdrawal, Linden Street branch");

  if (month.month % 3 === 0) {
    ledger.book("investment", businessDay(dayOf(month, 15)), 3800 + month.month * 270, "Northwind Brokerage", "Dividend distribution, Global Equity ETF");
  }
}

type Trip = {
  first: PlainDate;
  last: PlainDate;
};

function saturdayOnOrAfter(date: PlainDate) {
  return date.add({
    days: (6 - date.dayOfWeek + 7) % 7
  });
}

/** Summer holiday abroad: booked months ahead, paid by card, partly financed from savings. */
function bookSummerTrip(ledger: Ledger, random: DemoRandom, year: number): Trip {
  const first = saturdayOnOrAfter(Temporal.PlainDate.from({
    year,
    month: year % 2 === 0 ? 8 : 7,
    day: year % 2 === 0 ? 1 : 12
  }));
  const last = first.add({
    days: 13
  });

  ledger.book("creditCard", first.subtract({
    days: 104
  }), -random.amount(320, 460), "SkyHarbor Airlines", `Flight booking SH ${random.integer(1000, 1999)}`);
  ledger.book("creditCard", first.subtract({
    days: 90
  }), -29400, "Seaside Apartments", "Holiday apartment, deposit");
  ledger.transfer("savings", "checking", businessDay(first.subtract({
    days: 9
  })), 120000, "Holiday money");
  ledger.book("checking", first, -random.amount(32, 46), "CityCab", "Taxi to the airport");
  ledger.book("creditCard", first, -68600, "Seaside Apartments", "Holiday apartment, final payment");

  for (let day = first; Temporal.PlainDate.compare(day, last) <= 0; day = day.add({
    days: 1
  })) {
    const payments = random.integer(1, 3);

    for (let index = 0; index < payments; index++) {
      ledger.book("creditCard", day, -random.amount(6, 85), random.pick(placesAbroad), "Card payment abroad");
    }
  }

  return {
    first,
    last
  };
}

// The city break is paid in pounds, so its card payments show the original amount next to the booked euros.
function paidInPounds(euroAmount: number): ProviderDetails {
  return {
    instructedAmount: Math.round(euroAmount * 0.85),
    instructedCurrency: "GBP"
  };
}

function bookShortTrips(ledger: Ledger, random: DemoRandom, year: number) {
  const skiFriday = saturdayOnOrAfter(Temporal.PlainDate.from({
    year,
    month: 2,
    day: 7
  })).subtract({
    days: 1
  });
  const cityThursday = saturdayOnOrAfter(Temporal.PlainDate.from({
    year,
    month: 5,
    day: 10
  })).subtract({
    days: 2
  });

  ledger.book("creditCard", skiFriday.subtract({
    days: 30
  }), -38600, "Edelweiss Lodge", "Hotel, two nights");
  ledger.book("creditCard", skiFriday, -7980, "National Rail", "Return ticket, Alpine Ridge");
  ledger.book("creditCard", skiFriday.add({
    days: 1
  }), -11200, "Alpine Ridge Ski Pass", "Two-day ski pass");
  ledger.book("creditCard", cityThursday.subtract({
    days: 45
  }), -46200, "Canal View Hotel", "City break, three nights");
  ledger.book("creditCard", cityThursday, -11840, "National Rail", "Return ticket, city break");

  for (let index = 0; index < 4; index++) {
    const amount = random.amount(14, 58);

    ledger.book("creditCard", cityThursday.add({
      days: index
    }), -amount, random.pick(placesAbroad), "Card payment abroad", false, paidInPounds(-amount));
  }
}

function isWithinTrips(date: PlainDate, trips: Trip[]) {
  return trips.some(trip => isBetween(date, trip.first, trip.last));
}

/** Everyday card and debit card spending with weekly rhythm and seasonal peaks. */
function bookDay(ledger: Ledger, random: DemoRandom, day: PlainDate) {
  const weekday = day.dayOfWeek;
  const weekend = weekday >= 6;
  const december = day.month === 12;
  const festive = december && day.day >= 14 ? 1.35 : 1;

  if (weekday === 6) {
    ledger.book("joint", day, -Math.round(random.amount(52, 104) * festive), "Greenleaf Market", "Debit card purchase");

    if (random.chance(0.45)) {
      ledger.book("cash", day, -random.amount(11, 29), "Linden Farmers Market", "Cash payment");
    }
  }

  if ((weekday === 2 || weekday === 4) && random.chance(0.75)) {
    ledger.book("joint", day, -Math.round(random.amount(8.5, 36) * festive), "Daily Basket", "Debit card purchase");
  }

  if (weekend && random.chance(0.5)) {
    ledger.book("cash", day, -random.amount(3.8, 11.5), "Golden Crust Bakery", "Cash payment");
  }

  if (!weekend && random.chance(0.3)) {
    ledger.book("onlineChecking", day, -random.amount(6.4, 9.8), "Staff canteen", "Lunch");
  }

  if (random.chance(weekday >= 5 && weekday <= 6 ? 0.35 : 0.08)) {
    ledger.book("checking", day, -random.amount(14, 72), random.pick(restaurants), "Debit card purchase");
  }

  if (random.chance(0.06)) {
    ledger.book("creditCard", day, -random.amount(17, 38), "QuickFork Delivery", "Food delivery");
  }

  if (random.chance(0.03)) {
    ledger.book("creditCard", day, -random.amount(19.9, 89), "National Rail", "Train ticket");
  }

  if (random.chance(0.04)) {
    ledger.book("creditCard", day, -random.amount(16, 64), "ShareDrive", "Car sharing trip");
  }

  if (random.chance(0.012)) {
    ledger.book("checking", day, -random.amount(14, 32), "CityCab", "Taxi ride");
  }

  if (random.chance(weekend ? 0.1 : 0.03)) {
    ledger.book("onlineChecking", day, -random.amount(11.5, 26), "Riverside Cinema", "Debit card purchase");
  }

  if (random.chance(0.03)) {
    ledger.book("onlineChecking", day, -random.amount(9, 34), "Old Town Bookshop", "Debit card purchase");
  }

  if (random.chance(0.012)) {
    ledger.book("creditCard", day, -random.amount(38, 96), "Concert Hall Box Office", "Concert tickets");
  }

  if ((day.month >= 10 || day.month <= 4) && (weekday === 2 || weekday === 4) && random.chance(0.3)) {
    ledger.book("checking", day, -1400, "Northside Climbing Hall", "Day pass");
  }

  if (day.month >= 6 && day.month <= 8 && weekend && random.chance(0.5)) {
    ledger.book("cash", day, -550, "Lido Summer Pool", "Day ticket");
  }

  if (random.chance(0.04)) {
    ledger.book("checking", day, -random.amount(4.9, 28.6), "Linden Pharmacy", "Debit card purchase");
  }

  if (random.chance(0.09)) {
    ledger.book("onlineChecking", day, -random.amount(48, 74), "Fuelstop Service Station", "Debit card purchase");
  }

  if (random.chance(0.07)) {
    const amount = random.amount(12, 95);
    const order = random.integer(100000, 999999);

    ledger.book("creditCard", day, -amount, "Parcelbay Marketplace", `Order ${order}`);

    if (random.chance(0.12)) {
      ledger.book("creditCard", day.add({
        days: random.integer(6, 14)
      }), amount, "Parcelbay Marketplace", `Refund order ${order}`);
    }
  }

  if (random.chance(0.025)) {
    ledger.book("checking", day, -random.amount(19, 129), "Hometown Department Store", "Debit card purchase");
  }

  if (day.month >= 4 && day.month <= 9 && random.chance(0.015)) {
    ledger.book("creditCard", day, -random.amount(39, 189), "Trailhead Outdoor", "Outdoor equipment");
  }

  if (random.chance(0.01)) {
    ledger.book("checking", day, -random.amount(24, 65), "Gift Box Studio", "Birthday gift");
  }

  if (december && day.day <= 23 && random.chance(0.4)) {
    ledger.book("checking", day, -random.amount(25, 160), random.pick(christmasShops), "Christmas gifts");
  }

  const marketSeason = (day.month === 11 && day.day >= 20) || (december && day.day <= 23);

  if (marketSeason && weekday >= 5 && random.chance(0.3)) {
    ledger.book("cash", day, -random.amount(6, 28), "Winter Market Stalls", "Cash payment");
  }
}

/** Larger irregular purchases and refunds at fixed distances from the run date, so every run shows them. */
function bookOneOffs(ledger: Ledger, runMonth: PlainYearMonth) {
  const monthsAgo = (months: number, day: number) => dayOf(runMonth.subtract({
    months
  }), day);

  ledger.book("creditCard", monthsAgo(14, 9), -144900, "Northside Electronics", "Laptop, 14-inch");
  ledger.book("checking", monthsAgo(12, 18), -38900, "Clearview Opticians", "Glasses and eye test");
  ledger.book("creditCard", monthsAgo(11, 4), -21400, "SkyHarbor Airlines", "Flight booking SH 2214");
  ledger.book("creditCard", monthsAgo(11, 25), 21400, "SkyHarbor Airlines", "Refund, cancelled flight SH 2214");
  ledger.transfer("savings", "checking", businessDay(monthsAgo(9, 10)), 150000, "New sofa");
  ledger.book("checking", monthsAgo(9, 12), -189000, "Nordhaus Furniture", "Sofa and delivery");
  ledger.book("checking", monthsAgo(7, 14), -16500, "Brightfix Handyman Services", "Boiler service and tap repair, flat 5");
  ledger.book("checking", monthsAgo(5, 21), -64900, "Appliance Center", "Washing machine incl. installation");
  ledger.book("checking", monthsAgo(3, 6), -68000, "Smilewell Dental Practice", "Dental crown");
  ledger.transferToManual("savings", "loan", businessDay(monthsAgo(8, 16)), 400000, "Special repayment, loan 7741");
  ledger.transferToManual("checking", "loan", businessDay(monthsAgo(2, 16)), 150000, "Special repayment, loan 7741");
  ledger.bookSplit("checking", monthsAgo(1, 13), "Hometown Department Store", "Debit card purchase", [{
    amount: -12950,
    categoryId: "demo-shopping",
    note: "Winter coat"
  }, {
    amount: -5690,
    categoryId: "demo-gifts",
    note: "Birthday present"
  }]);
  ledger.bookSplit("creditCard", monthsAgo(4, 9), "Parcelbay Marketplace", `Order ${400000 + runMonth.month * 1371}`, [{
    amount: -16490,
    categoryId: "demo-shopping",
    note: "Headphones"
  }, {
    amount: -7890,
    categoryId: "home",
    note: "Pans and kitchen scale"
  }]);
  ledger.bookSplit("joint", monthsAgo(6, 20), "Greenleaf Market", "Debit card purchase", [{
    amount: -14210,
    categoryId: "groceries",
    note: "Weekly shop"
  }, {
    amount: -7250,
    categoryId: "demo-gifts",
    note: "Gift hamper for the neighbours"
  }]);
}

function bookUnmatched(ledger: Ledger) {
  for (const row of unmatchedRows) {
    ledger.book(row.account, ledger.runDate.subtract({
      days: row.daysAgo
    }), row.amount, row.counterparty, row.description);
  }
}

/** Postings that depend on running balances: loan interest, savings interest and card statements. */
function bookBalanceDependent(ledger: Ledger, firstMonth: PlainYearMonth, runMonth: PlainYearMonth) {
  for (let month = firstMonth; Temporal.PlainYearMonth.compare(month, runMonth) <= 0; month = month.add({
    months: 1
  })) {
    const monthStart = dayOf(month, 1);
    const monthEnd = dayOf(month, 31);
    const previousMonthEnd = monthStart.subtract({
      days: 1
    });
    const statement = -ledger.balanceAt("creditCard", previousMonthEnd);

    if (Temporal.PlainYearMonth.compare(month, firstMonth) > 0 && statement > 0) {
      ledger.transfer("checking", "creditCard", businessDay(dayOf(month, 4)), statement, `Card statement ${monthLabel(month.subtract({
        months: 1
      }))}`);
    }

    const principal = -ledger.balanceAt("loan", previousMonthEnd);

    ledger.book("loan", monthEnd, -Math.round(principal * 0.031 / 12), "Riverside Bank", `Mortgage interest ${monthLabel(month)}`);

    if (month.month % 3 === 0) {
      const saved = ledger.balanceAt("savings", monthEnd);

      ledger.book("savings", monthEnd, Math.round(saved * 0.0175 / 4 * 0.75), "Riverside Bank", `Interest credit ${quarterLabel(monthEnd)}, after capital gains tax`);
    }
  }
}

/** Lowest balance each spending account may reach on any day; its opening balance is chosen to keep this cushion. */
const spendingCushions: Partial<Record<DemoAccountKey, number>> = {
  checking: 120000,
  onlineChecking: 18000,
  joint: 25000,
  cash: 3000
};

function chooseSpendingOpenings(ledger: Ledger) {
  for (const [account, cushion] of Object.entries(spendingCushions) as [DemoAccountKey, number][]) {
    ledger.openings[account] = openingWithCushion(ledger.entries[account], cushion);
  }
}

function openingWithCushion(entries: Entry[], cushion: number) {
  const dailyChanges = new Map<string, number>();

  for (const entry of entries) {
    dailyChanges.set(entry.date, (dailyChanges.get(entry.date) ?? 0) + entry.amount);
  }

  let running = 0;
  let lowest = 0;

  for (const date of [...dailyChanges.keys()].sort()) {
    running += dailyChanges.get(date) ?? 0;
    lowest = Math.min(lowest, running);
  }

  return Math.ceil((cushion - lowest) / 10000) * 10000;
}

function monthEnds(firstMonth: PlainYearMonth, runDate: PlainDate) {
  const dates: PlainDate[] = [];

  for (let month = firstMonth; ; month = month.add({
    months: 1
  })) {
    const end = dayOf(month, 31);

    if (Temporal.PlainDate.compare(end, runDate) >= 0) {
      break;
    }

    dates.push(end);
  }

  return [...dates, runDate];
}

/** Market value: contributions plus a seeded monthly return around a modest positive trend. */
function investmentSnapshots(ledger: Ledger, random: DemoRandom, dates: PlainDate[]) {
  let value = openingBalances.investment;
  let previous = ledger.firstDate.subtract({
    days: 1
  });

  return dates.map(date => {
    const from = previous.toString();
    const to = date.toString();
    const deposits = ledger.entries.investment.filter(entry => entry.date > from && entry.date <= to).reduce((total, entry) => total + entry.amount, 0);
    const monthlyReturn = (random.next() + random.next() + random.next() - 1.5) * 0.06 + 0.006;
    const share = Math.min(1, previous.until(date).days / 30);

    value = Math.round((value + deposits) * (1 + monthlyReturn * share));
    previous = date;

    return {
      date: to,
      amount: value
    };
  });
}

/** Quarterly property valuations with gentle appreciation. */
function propertySnapshots(random: DemoRandom, firstDate: PlainDate, runDate: PlainDate) {
  const snapshots: DemoSnapshot[] = [{
    date: firstDate.toString(),
    amount: openingBalances.property
  }];
  let value = openingBalances.property;

  for (let date = dayOf(firstDate.toPlainYearMonth(), 1); Temporal.PlainDate.compare(date, runDate) <= 0; date = date.add({
    months: 1
  })) {
    if (date.month % 3 !== 1 || Temporal.PlainDate.compare(date, firstDate) <= 0) {
      continue;
    }

    value = Math.round(value * (1 + random.integer(4, 11) / 1000) / 10000) * 10000;
    snapshots.push({
      date: date.toString(),
      amount: value
    });
  }

  return snapshots;
}

/** Quarterly car valuations that lose value as the car ages. */
function carSnapshots(firstDate: PlainDate, runDate: PlainDate) {
  const snapshots: DemoSnapshot[] = [];
  let value = openingBalances.car;

  for (let date = dayOf(firstDate.toPlainYearMonth(), 1); Temporal.PlainDate.compare(date, runDate) <= 0; date = date.add({
    months: 1
  })) {
    if (date.month % 3 !== 1 || Temporal.PlainDate.compare(date, firstDate) <= 0) {
      continue;
    }

    value = Math.round(value * 0.965 / 5000) * 5000;
    snapshots.push({
      date: date.toString(),
      amount: value
    });
  }

  return snapshots;
}

function accountData(ledger: Ledger, key: DemoAccountKey, valuations: DemoSnapshot[] = []): DemoAccountData {
  const lastValuation = valuations.at(-1);

  return {
    ...demoAccounts[key],
    opening: {
      date: ledger.firstDate.toString(),
      amount: ledger.openings[key]
    },
    entries: ledger.entries[key],
    valuations,
    closing: {
      date: ledger.runDate.toString(),
      amount: lastValuation ? lastValuation.amount + ledger.balanceAt(key, ledger.runDate) - ledger.balanceAt(key, Temporal.PlainDate.from(lastValuation.date)) : ledger.balanceAt(key, ledger.runDate)
    }
  };
}

/** Morning instant of a date in UTC, the time scheduled syncs run. */
function syncInstant(date: PlainDate, minute: number) {
  return Temporal.PlainDateTime.from({
    year: date.year,
    month: date.month,
    day: date.day,
    hour: 5,
    minute
  }).toZonedDateTime("UTC").toInstant().toString({
    fractionalSecondDigits: 3
  });
}

function connectionData(runDate: PlainDate) {
  return (Object.keys(demoConnections) as DemoConnectionKey[]).map(key => {
    const connection = demoConnections[key];
    const granted = runDate.subtract({
      days: connection.grantedDaysAgo
    });

    return {
      id: connection.id,
      bankName: connection.bankName,
      grantedAt: syncInstant(granted, 0),
      validUntil: syncInstant(granted.add({
        days: 180
      }), 0)
    };
  });
}

/** Two weeks of daily scheduled syncs; one run could not reach a bank and the next run caught up. */
function syncRunHistory(ledger: Ledger, random: DemoRandom): DemoSyncRun[] {
  const bankAccounts = (Object.keys(demoAccounts) as DemoAccountKey[]).filter(key => demoAccounts[key].bank);
  const runs: DemoSyncRun[] = [];

  const bookedOn = (key: DemoAccountKey, date: PlainDate) => ledger.entries[key].filter(entry => entry.date === date.toString()).length;
  let missed = 0;

  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const date = ledger.runDate.subtract({
      days: daysAgo
    });
    const booked = date.subtract({
      days: 1
    });
    const failed = daysAgo === 4;
    const insertedCount = bankAccounts.filter(key => !failed || key !== "onlineChecking").reduce((total, key) => total + bookedOn(key, booked), missed);

    // The next run fetches what the failed run missed.
    missed = failed ? bookedOn("onlineChecking", booked) : 0;
    const minute = random.integer(0, 4);

    runs.push({
      id: `demo-sync-run-${date.toString()}`,
      startedAt: syncInstant(date, minute),
      finishedAt: syncInstant(date, minute + 1),
      status: failed ? "PARTIAL" : "SUCCESS",
      insertedCount,
      error: failed ? `${demoAccounts.onlineChecking.name}: The bank did not respond in time. Try again later.` : null
    });
  }

  return runs;
}

/** Builds the complete synthetic history ending on the run date; the same run date always produces the same dataset. */
export function buildDemoDataset(runDate: PlainDate): DemoDataset {
  const firstDate = runDate.subtract({
    months: demoHistoryMonths
  });
  const firstMonth = firstDate.toPlainYearMonth();
  const runMonth = runDate.toPlainYearMonth();
  const random = new DemoRandom(`ufer-demo:${runDate.toString()}`);
  const ledger = new Ledger(firstDate, runDate);
  const trips: Trip[] = [];

  for (let year = firstDate.year; year <= runDate.year; year++) {
    trips.push(bookSummerTrip(ledger, random, year));
    bookShortTrips(ledger, random, year);
  }

  for (let month = firstMonth; Temporal.PlainYearMonth.compare(month, runMonth) <= 0; month = month.add({
    months: 1
  })) {
    const context = {
      ledger,
      random,
      month,
      runMonth
    };

    bookIncome(context);
    bookHousing(context);
    bookContracts(context);
    bookYearlyItems(context);
    bookSavings(context);
  }

  for (let day = firstDate; Temporal.PlainDate.compare(day, runDate) <= 0; day = day.add({
    days: 1
  })) {
    if (!isWithinTrips(day, trips)) {
      bookDay(ledger, random, day);
    }
  }

  bookOneOffs(ledger, runMonth);
  bookUnmatched(ledger);
  bookBalanceDependent(ledger, firstMonth, runMonth);
  chooseSpendingOpenings(ledger);

  const dates = monthEnds(firstMonth, runDate);
  const syncRuns = syncRunHistory(ledger, random);

  return {
    firstDate: firstDate.toString(),
    runDate: runDate.toString(),
    accounts: [
      accountData(ledger, "checking"),
      accountData(ledger, "onlineChecking"),
      accountData(ledger, "joint"),
      accountData(ledger, "cash"),
      accountData(ledger, "savings"),
      accountData(ledger, "creditCard"),
      accountData(ledger, "investment", investmentSnapshots(ledger, random, dates)),
      accountData(ledger, "property", propertySnapshots(random, firstDate, runDate)),
      accountData(ledger, "car", carSnapshots(firstDate, runDate)),
      accountData(ledger, "loan")
    ],
    createdCounterparts: ledger.createdCounterparts.map(item => ({
      sourceAccountId: demoAccounts[item.from].id,
      sourceReference: item.reference,
      accountId: demoAccounts[item.to].id
    })),
    splits: ledger.splits,
    connections: connectionData(runDate),
    syncRuns,
    lastSyncedAt: syncRuns.at(-1)?.finishedAt ?? syncInstant(runDate, 0)
  };
}
