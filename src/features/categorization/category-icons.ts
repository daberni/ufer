// Persisted keys are a stable contract: rename or remove a key only through a data migration. Labels, groups and keywords may change freely.
// The English labels and group names here are search and suggestion terms; the interface shows the translated names from the categorization catalog.
export const categoryIconGroups = {
  food: "Food & drink",
  transport: "Transport",
  home: "Home",
  health: "Health & care",
  money: "Money",
  leisure: "Leisure",
  travel: "Travel",
  family: "Family & pets",
  shopping: "Shopping",
  work: "Work",
  other: "Other"
} as const;

export type CategoryIconGroup = keyof typeof categoryIconGroups;

type CategoryIconDefinition = {
  label: string;
  group: CategoryIconGroup;
  /** Additional search terms besides the label. */
  keywords: string;
};

export const categoryIcons = {
  groceries: {
    label: "Groceries",
    group: "food",
    keywords: "supermarket food market"
  },
  dining: {
    label: "Dining",
    group: "food",
    keywords: "restaurant eating out meal"
  },
  coffee: {
    label: "Coffee & cafés",
    group: "food",
    keywords: "cafe tea"
  },
  bar: {
    label: "Bars & alcohol",
    group: "food",
    keywords: "drinks wine pub"
  },
  beer: {
    label: "Beer & pubs",
    group: "food",
    keywords: "pub brewery"
  },
  takeaway: {
    label: "Takeaway & pizza",
    group: "food",
    keywords: "delivery"
  },
  "fast-food": {
    label: "Fast food",
    group: "food",
    keywords: "burger snack"
  },
  bakery: {
    label: "Bakery",
    group: "food",
    keywords: "bread pastry"
  },
  fruit: {
    label: "Fruit & vegetables",
    group: "food",
    keywords: "market produce"
  },
  sweets: {
    label: "Sweets & snacks",
    group: "food",
    keywords: "candy chocolate"
  },
  lunch: {
    label: "Lunch",
    group: "food",
    keywords: "canteen work meal"
  },
  cooking: {
    label: "Cooking",
    group: "food",
    keywords: "kitchen recipes"
  },
  salad: {
    label: "Healthy food",
    group: "food",
    keywords: "organic vegan"
  },
  transport: {
    label: "Transport",
    group: "transport",
    keywords: "car vehicle"
  },
  fuel: {
    label: "Fuel",
    group: "transport",
    keywords: "gas petrol diesel"
  },
  transit: {
    label: "Public transport",
    group: "transport",
    keywords: "tram metro subway ticket"
  },
  train: {
    label: "Train",
    group: "transport",
    keywords: "rail railway"
  },
  bus: {
    label: "Bus",
    group: "transport",
    keywords: "coach"
  },
  taxi: {
    label: "Taxi & ride-hailing",
    group: "transport",
    keywords: "cab uber"
  },
  bicycle: {
    label: "Bicycle",
    group: "transport",
    keywords: "bike cycling"
  },
  parking: {
    label: "Parking",
    group: "transport",
    keywords: "garage"
  },
  "ev-charging": {
    label: "EV charging",
    group: "transport",
    keywords: "electric car charging"
  },
  "car-service": {
    label: "Car service & repairs",
    group: "transport",
    keywords: "mechanic maintenance tires"
  },
  tolls: {
    label: "Tolls & vignette",
    group: "transport",
    keywords: "highway motorway"
  },
  "car-sharing": {
    label: "Car rental & sharing",
    group: "transport",
    keywords: "rental lease"
  },
  housing: {
    label: "Housing",
    group: "home",
    keywords: "home"
  },
  rent: {
    label: "Rent",
    group: "home",
    keywords: "apartment flat landlord"
  },
  utilities: {
    label: "Utilities",
    group: "home",
    keywords: "energy power"
  },
  electricity: {
    label: "Electricity",
    group: "home",
    keywords: "power energy"
  },
  heating: {
    label: "Heating & gas",
    group: "home",
    keywords: "gas warmth"
  },
  water: {
    label: "Water",
    group: "home",
    keywords: "sewage"
  },
  internet: {
    label: "Internet",
    group: "home",
    keywords: "broadband wifi"
  },
  furniture: {
    label: "Furniture & home",
    group: "home",
    keywords: "decor"
  },
  repairs: {
    label: "Repairs & DIY",
    group: "home",
    keywords: "tools hardware"
  },
  renovation: {
    label: "Renovation",
    group: "home",
    keywords: "paint decorating"
  },
  cleaning: {
    label: "Cleaning",
    group: "home",
    keywords: "household supplies"
  },
  garden: {
    label: "Garden & plants",
    group: "home",
    keywords: "flowers plants"
  },
  appliances: {
    label: "Appliances",
    group: "home",
    keywords: "laundry washing"
  },
  health: {
    label: "Health",
    group: "health",
    keywords: "medical"
  },
  pharmacy: {
    label: "Pharmacy",
    group: "health",
    keywords: "medicine drugs"
  },
  doctor: {
    label: "Doctor",
    group: "health",
    keywords: "physician medical"
  },
  hospital: {
    label: "Hospital",
    group: "health",
    keywords: "clinic"
  },
  dentist: {
    label: "Dentist",
    group: "health",
    keywords: "teeth dental"
  },
  optician: {
    label: "Glasses & optician",
    group: "health",
    keywords: "eyes lenses"
  },
  therapy: {
    label: "Therapy & mental health",
    group: "health",
    keywords: "psychologist counselling"
  },
  fitness: {
    label: "Sport & fitness",
    group: "health",
    keywords: "gym workout"
  },
  wellness: {
    label: "Spa & wellness",
    group: "health",
    keywords: "sauna massage"
  },
  hairdresser: {
    label: "Hairdresser",
    group: "health",
    keywords: "haircut barber"
  },
  beauty: {
    label: "Beauty & cosmetics",
    group: "health",
    keywords: "cosmetics skincare"
  },
  income: {
    label: "Income",
    group: "money",
    keywords: "earnings"
  },
  salary: {
    label: "Salary & work",
    group: "money",
    keywords: "wage paycheck job"
  },
  savings: {
    label: "Savings",
    group: "money",
    keywords: "reserve"
  },
  investments: {
    label: "Investments",
    group: "money",
    keywords: "portfolio"
  },
  stocks: {
    label: "Stocks & funds",
    group: "money",
    keywords: "shares etf"
  },
  crypto: {
    label: "Crypto",
    group: "money",
    keywords: "bitcoin"
  },
  interest: {
    label: "Interest",
    group: "money",
    keywords: "rates"
  },
  pension: {
    label: "Pension",
    group: "money",
    keywords: "retirement"
  },
  cash: {
    label: "Cash",
    group: "money",
    keywords: "atm withdrawal"
  },
  "credit-card": {
    label: "Credit card",
    group: "money",
    keywords: "card"
  },
  transfer: {
    label: "Transfer",
    group: "money",
    keywords: "move"
  },
  refunds: {
    label: "Refunds",
    group: "money",
    keywords: "return reimbursement"
  },
  loan: {
    label: "Loans & debt",
    group: "money",
    keywords: "mortgage bank credit"
  },
  fees: {
    label: "Fees & taxes",
    group: "money",
    keywords: "charges bank"
  },
  bills: {
    label: "Bills & invoices",
    group: "money",
    keywords: "invoice"
  },
  taxes: {
    label: "Taxes & accounting",
    group: "money",
    keywords: "tax return accountant"
  },
  insurance: {
    label: "Insurance",
    group: "money",
    keywords: "policy"
  },
  entertainment: {
    label: "Entertainment",
    group: "leisure",
    keywords: "events tickets"
  },
  subscriptions: {
    label: "Subscriptions & streaming",
    group: "leisure",
    keywords: "netflix streaming tv"
  },
  hobbies: {
    label: "Hobbies",
    group: "leisure",
    keywords: "art crafts"
  },
  music: {
    label: "Music",
    group: "leisure",
    keywords: "spotify concerts"
  },
  cinema: {
    label: "Cinema & movies",
    group: "leisure",
    keywords: "film movies"
  },
  games: {
    label: "Games",
    group: "leisure",
    keywords: "gaming video games"
  },
  books: {
    label: "Books",
    group: "leisure",
    keywords: "reading ebooks"
  },
  concerts: {
    label: "Concerts & events",
    group: "leisure",
    keywords: "festival live"
  },
  "sports-club": {
    label: "Sports clubs",
    group: "leisure",
    keywords: "club membership"
  },
  photography: {
    label: "Photography",
    group: "leisure",
    keywords: "camera photos"
  },
  swimming: {
    label: "Swimming",
    group: "leisure",
    keywords: "pool beach"
  },
  hiking: {
    label: "Hiking & outdoors",
    group: "leisure",
    keywords: "outdoor mountains"
  },
  "winter-sports": {
    label: "Winter sports",
    group: "leisure",
    keywords: "ski skiing snow"
  },
  parties: {
    label: "Parties",
    group: "leisure",
    keywords: "celebration"
  },
  travel: {
    label: "Travel",
    group: "travel",
    keywords: "flights holiday"
  },
  hotel: {
    label: "Hotels & lodging",
    group: "travel",
    keywords: "accommodation airbnb"
  },
  "beach-holiday": {
    label: "Beach holiday",
    group: "travel",
    keywords: "vacation summer"
  },
  sightseeing: {
    label: "Sightseeing",
    group: "travel",
    keywords: "tours museum"
  },
  childcare: {
    label: "Kids & childcare",
    group: "family",
    keywords: "children daycare"
  },
  education: {
    label: "Education",
    group: "family",
    keywords: "university course tuition"
  },
  school: {
    label: "School",
    group: "family",
    keywords: "tuition"
  },
  toys: {
    label: "Toys",
    group: "family",
    keywords: "lego play"
  },
  "pocket-money": {
    label: "Pocket money",
    group: "family",
    keywords: "allowance"
  },
  family: {
    label: "Family",
    group: "family",
    keywords: "relatives"
  },
  dating: {
    label: "Love & dating",
    group: "family",
    keywords: "partner date"
  },
  birthdays: {
    label: "Birthdays",
    group: "family",
    keywords: "celebration party"
  },
  gifts: {
    label: "Gifts",
    group: "family",
    keywords: "presents"
  },
  charity: {
    label: "Charity & donations",
    group: "family",
    keywords: "donation"
  },
  pets: {
    label: "Pets",
    group: "family",
    keywords: "animals"
  },
  dog: {
    label: "Dog",
    group: "family",
    keywords: "pet"
  },
  shopping: {
    label: "Shopping",
    group: "shopping",
    keywords: "retail"
  },
  clothing: {
    label: "Clothing",
    group: "shopping",
    keywords: "clothes fashion"
  },
  shoes: {
    label: "Shoes",
    group: "shopping",
    keywords: "footwear"
  },
  accessories: {
    label: "Watches & accessories",
    group: "shopping",
    keywords: "jewelry"
  },
  electronics: {
    label: "Electronics",
    group: "shopping",
    keywords: "computer gadgets"
  },
  phone: {
    label: "Phone & internet",
    group: "shopping",
    keywords: "mobile cell"
  },
  "online-orders": {
    label: "Online orders",
    group: "shopping",
    keywords: "amazon parcel delivery"
  },
  "department-store": {
    label: "Department store",
    group: "shopping",
    keywords: "shop"
  },
  "second-hand": {
    label: "Second hand",
    group: "shopping",
    keywords: "used flea market"
  },
  office: {
    label: "Office supplies",
    group: "work",
    keywords: "printer paper"
  },
  software: {
    label: "Software & cloud",
    group: "work",
    keywords: "apps saas"
  },
  freelance: {
    label: "Freelance",
    group: "work",
    keywords: "self-employed design"
  },
  training: {
    label: "Training & conferences",
    group: "work",
    keywords: "conference seminar"
  },
  legal: {
    label: "Legal & advisory",
    group: "work",
    keywords: "lawyer notary"
  },
  postage: {
    label: "Postage & shipping",
    group: "work",
    keywords: "mail post shipping"
  },
  other: {
    label: "Other",
    group: "other",
    keywords: "misc"
  },
  memberships: {
    label: "Memberships",
    group: "other",
    keywords: "club card"
  },
  government: {
    label: "Government & fees",
    group: "other",
    keywords: "authorities official"
  },
  church: {
    label: "Church & religion",
    group: "other",
    keywords: "church tax religion"
  },
  tobacco: {
    label: "Tobacco",
    group: "other",
    keywords: "smoking cigarettes"
  },
  lottery: {
    label: "Lottery & betting",
    group: "other",
    keywords: "gambling"
  },
  fines: {
    label: "Fines & penalties",
    group: "other",
    keywords: "ticket penalty"
  }
} as const satisfies Record<string, CategoryIconDefinition>;

export type CategoryIconKey = keyof typeof categoryIcons;

export const categoryIconKeys = Object.keys(categoryIcons) as CategoryIconKey[];

export function isCategoryIcon(value: unknown): value is CategoryIconKey {
  return typeof value === "string" && Object.hasOwn(categoryIcons, value);
}

const wordSeparator = /[^\p{L}\p{N}]+/u;

function searchWords(text: string) {
  return text.toLowerCase().split(wordSeparator).filter(Boolean);
}

/**
 * Whether every word of the search starts a word of the icon's label, group or keywords, so "car" finds "Car" and "card" but not "childcare". Letter case
 * is ignored independent of the browser locale. `shownNames` adds the label and group as the interface language shows them.
 */
export function matchesCategoryIconSearch(key: CategoryIconKey, search: string, shownNames = "") {
  const icon = categoryIcons[key];
  const iconWords = searchWords(`${icon.label} ${categoryIconGroups[icon.group]} ${icon.keywords} ${shownNames}`);

  return searchWords(search).every(query => iconWords.some(word => word.startsWith(query)));
}

// A trailing plural "s" does not keep "Pets" from matching "pet".
function stem(word: string) {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function wordMatch(nameWord: string, iconWord: string) {
  const name = stem(nameWord);
  const icon = stem(iconWord);

  if (name === icon) {
    return 0;
  }

  // A started word such as "groc" or a longer form such as "fuels" still matches; short words must match exactly.
  if (name.length >= 4 && icon.length >= 4 && (icon.startsWith(name) || name.startsWith(icon))) {
    return 1;
  }

  return null;
}

/** Ranks how well the name words fit an icon; lower is better, null when nothing matches. */
function iconRank(words: string[], key: CategoryIconKey) {
  const icon = categoryIcons[key];
  const labelWords = searchWords(icon.label);
  const quality = (iconWord: string) => Math.min(...words.map(word => wordMatch(word, iconWord) ?? 2));
  const labelQualities = labelWords.map(quality).filter(value => value < 2);
  const keywordQualities = searchWords(icon.keywords).map(quality).filter(value => value < 2);

  if (labelQualities.length === 0 && keywordQualities.length === 0) {
    return null;
  }

  // A name covering the whole label wins, then more covered label words, then a label over a keyword match, then exact over started words.
  const complete = labelQualities.length === labelWords.length ? 0 : 1;
  const bestQuality = Math.min(...labelQualities, ...keywordQualities);

  return [complete, -labelQualities.length, labelQualities.length > 0 ? 0 : 1, bestQuality];
}

function compareRanks(first: number[], second: number[]) {
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) {
      return first[index] - second[index];
    }
  }

  return 0;
}

function bestIconFor(words: string[]) {
  let best: {
    key: CategoryIconKey;
    rank: number[];
  } | null = null;

  // Catalog order decides between equal ranks because only a better rank replaces the current best.
  for (const key of categoryIconKeys) {
    const rank = iconRank(words, key);

    if (rank && (!best || compareRanks(rank, best.rank) < 0)) {
      best = {
        key,
        rank
      };
    }
  }

  return best;
}

/**
 * The icon whose label or keywords match a word of the category name, or null. The part after the last " / " decides first, so "Car / Fuel" suggests
 * fuel rather than a car icon. Words shorter than three letters are ignored.
 */
export function suggestCategoryIcon(name: string): CategoryIconKey | null {
  const parts = name.split(" / ");
  const own = parts[parts.length - 1];
  const segments = parts.length > 1 ? [own, name] : [name];

  for (const segment of segments) {
    const words = searchWords(segment).filter(word => word.length >= 3);
    const match = bestIconFor(words);

    if (match) {
      return match.key;
    }
  }

  return null;
}
