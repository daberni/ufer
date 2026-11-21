import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { z } from "zod";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { HttpError } from "../src/lib/errors";
import { builtInTemplates, buxferTemplate, decodeCsv, detectDelimiter, mapRows, matchTemplate, parseCsv, suggestMapping, templateFromMapping, templateLabel, templateMapping, templateSettings, type CsvSettings, type CsvTemplate } from "../src/features/imports/csv-mapping";
import { categoryValues, rememberedChoices, resolveCategories, resolveTargets, sourceAccounts, templateChoices, type CategorySelection, type TargetChoice } from "../src/features/imports/import-plan";
import { textsMatch } from "../src/features/imports/server/duplicate-matching";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { assignOccurrences } from "../src/features/imports/csv-mapping";
import { uniqueWrite } from "../src/features/imports/server/template-repository";
import { changeTemplate, createTemplate, duplicateTemplate, readTemplates, removeTemplate } from "../src/features/imports/server/template-service";

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;

  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;

  context.after(() => {
    globals.budgetDb = previousDatabase;
    process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    client.close();
  });
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);

  return db;
}

// Synthetic Buxfer export: two accounts, a multi-tag row, a transfer pair and a description Buxfer shortened with "...".
const buxferCsv = [
  "ID,Date,Description,Currency,Amount,Type,Tags,Account,Status,Memo,IOU",
  "9001,2024-03-01,Example Grocer,EUR,-42.10,Expense,Groceries,Example Checking,Reconciled,,",
  "9002,2024-03-02,Example Employer Salary,EUR,2500.00,Income,Salary,Example Checking,Reconciled,,",
  "9003,2024-03-03,Example Café,EUR,-12.50,Expense,\"Dining,Travel\",Example Card,Pending,note,",
  "9004,2024-03-04,Transfer to Example Card,EUR,-100.00,Transfer,,Example Checking,Reconciled,,",
  "9005,2024-03-04,Transfer from Example Checking,EUR,100.00,Transfer,,Example Card,Reconciled,,",
  "9006,2024-03-05,Example Hardware Store Purchase Number 12...,EUR,-1234.56,Expense,Home,Example Card,Reconciled,,"
].join("\n");

function readBuxfer(saved: CsvTemplate[] = []) {
  const decoded = decodeCsv(new TextEncoder().encode(buxferCsv));
  const [header, ...rows] = parseCsv(decoded.text, detectDelimiter(decoded.text));
  const template = matchTemplate(header, [...saved, ...builtInTemplates]);

  return {
    header,
    rows,
    template,
    settings: {
      encoding: decoded.encoding,
      delimiter: ",",
      // Deliberately different from Buxfer's format, so the test sees the template's settings win.
      decimal: ",",
      dateFormat: "DD.MM.YYYY",
      ...template?.settings
    } satisfies CsvSettings
  };
}

test("a Buxfer export is recognized and maps IDs, accounts, signed amounts and tags", () => {
  const {
    header,
    rows,
    template,
    settings
  } = readBuxfer();

  assert.equal(template?.id, buxferTemplate.id);

  const result = mapRows(rows, templateMapping(template!, header), settings, "en");

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(row => [row.id, row.date, row.amount, row.source]), [
    ["9001", "2024-03-01", "-42.10", "Example Checking"],
    ["9002", "2024-03-02", "2500.00", "Example Checking"],
    ["9003", "2024-03-03", "-12.50", "Example Card"],
    ["9004", "2024-03-04", "-100.00", "Example Checking"],
    ["9005", "2024-03-04", "100.00", "Example Card"],
    ["9006", "2024-03-05", "-1234.56", "Example Card"]
  ]);
  assert.deepEqual(sourceAccounts(result.rows).map(source => source.source), ["Example Checking", "Example Card"]);

  const values = categoryValues(result.rows, []);

  assert.equal(values.find(value => value.value === "Dining,Travel")?.multiTag, true);
  assert.equal(values.find(value => value.value === "Groceries")?.multiTag, false);
  // Status, Memo and IOU never reach a row.
  assert.equal(result.rows[2].description, "Example Café");
});

test("a shortened Buxfer description still matches the full bank booking", () => {
  const {
    header,
    rows,
    template,
    settings
  } = readBuxfer();
  const truncated = mapRows(rows, templateMapping(template!, header), settings, "en").rows[5];

  assert.equal(textsMatch({
    counterparty: truncated.payee,
    description: truncated.description
  }, {
    counterparty: "Example Hardware Store",
    description: "Example Hardware Store Purchase Number 1234567"
  }), true);
});

test("only an exact header matches a template, and a saved template wins over the built-in one", () => {
  assert.equal(matchTemplate([...buxferTemplate.header, "Extra"], builtInTemplates), null);
  assert.equal(matchTemplate(buxferTemplate.header.slice(0, -1), builtInTemplates), null);
  assert.equal(matchTemplate(buxferTemplate.header.map(column => ` ${column} `), builtInTemplates)?.id, buxferTemplate.id);

  const saved: CsvTemplate = {
    ...buxferTemplate,
    id: "saved",
    name: "My Buxfer",
    builtIn: false,
    accounts: {
      "Example Card": "card"
    }
  };

  assert.equal(readBuxfer([saved]).template?.id, "saved");
});

test("a saved mapping reproduces the roles, format and still existing choices on the next file", () => {
  const header = ["Buchungsdatum", "Betrag", "Empfänger", "Kategorie", "Konto"];
  const mapping = suggestMapping(header);
  const settings: CsvSettings = {
    encoding: "windows-1252",
    delimiter: ";",
    decimal: ",",
    dateFormat: "DD.MM.YYYY"
  };
  const targets = new Map<string, TargetChoice>([
    ["Giro", {
      kind: "existing",
      accountId: "giro"
    }],
    ["Old card", {
      kind: "existing",
      accountId: "deleted-account"
    }],
    ["Closed", {
      kind: "new",
      name: "Closed",
      accountKind: "checking",
      currency: "EUR",
      balanceKind: "current",
      balance: ""
    }]
  ]);
  const selections = new Map<string, CategorySelection>([
    ["Lebensmittel", {
      action: "existing",
      categoryId: "groceries"
    }],
    ["Neu", {
      action: "create",
      category: {
        name: "Neu",
        color: "#638777",
        icon: null
      }
    }]
  ]);
  const choices = rememberedChoices(targets, selections);
  const template = templateFromMapping(" Bank export ", header, mapping, settings, choices.accounts, choices.categories);

  assert.equal(template.name, "Bank export");
  assert.deepEqual(template.settings, {
    decimal: ",",
    dateFormat: "DD.MM.YYYY"
  });
  assert.deepEqual(template.accounts, {
    "Giro": "giro",
    "Old card": "deleted-account"
  });
  assert.deepEqual(template.categories, {
    Lebensmittel: "groceries"
  });

  const stored: CsvTemplate = {
    ...template,
    id: "t1",
    builtIn: false
  };

  assert.equal(matchTemplate(header, [stored])?.id, "t1");
  assert.deepEqual(templateMapping(stored, header), mapping);

  const applied = templateChoices(stored, [{
    id: "giro",
    name: "Giro",
    currency: "EUR"
  }], [{
    id: "groceries"
  }]);

  assert.deepEqual([...applied.targets], [["Giro", {
    kind: "existing",
    accountId: "giro"
  }]]);
  assert.deepEqual([...applied.selections], [["Lebensmittel", {
    action: "existing",
    categoryId: "groceries"
  }]]);
});

const savedInput = {
  name: "Bank export",
  header: ["Date", "Amount", "Payee"],
  settings: {
    decimal: ",",
    dateFormat: "DD.MM.YYYY"
  },
  columns: {
    date: 0,
    amount: 1,
    payee: 2
  },
  accounts: {},
  categories: {
    Food: "groceries"
  }
};

test("templates are stored, listed, renamed, updated and deleted", async context => {
  await isolatedDatabase(context);

  const { id } = await createTemplate(savedInput);
  const [stored] = await readTemplates();

  assert.deepEqual(stored, {
    ...savedInput,
    id,
    builtIn: false
  });

  await changeTemplate(id, {
    name: "Renamed"
  });
  await changeTemplate(id, {
    definition: {
      header: savedInput.header,
      settings: savedInput.settings,
      columns: savedInput.columns,
      accounts: {
        Giro: "giro"
      },
      categories: {}
    }
  });

  const [changed] = await readTemplates();

  assert.equal(changed.name, "Renamed");
  assert.deepEqual(changed.accounts, {
    Giro: "giro"
  });
  assert.deepEqual(changed.categories, {});

  await removeTemplate(id);
  assert.deepEqual(await readTemplates(), builtInTemplates);
  await assert.rejects(removeTemplate(id), (error: unknown) => error instanceof HttpError && error.status === 404);
});

test("a second template for the same columns or name is rejected, and invalid definitions are refused", async context => {
  await isolatedDatabase(context);
  await createTemplate(savedInput);

  await assert.rejects(createTemplate({
    ...savedInput,
    name: "Other name"
  }), (error: unknown) => error instanceof HttpError && error.status === 409 && /already covers/.test(error.message));
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "bank EXPORT",
    header: ["Date", "Amount", "Payee", "Extra"]
  }), (error: unknown) => error instanceof HttpError && error.status === 409 && /already exists/.test(error.message));
  await createTemplate({
    ...savedInput,
    name: "Ärzte",
    header: ["Datum", "Betrag", "Arzt"]
  });
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "ärzte",
    header: ["Datum", "Betrag", "Praxis"]
  }), (error: unknown) => error instanceof HttpError && error.status === 409 && /already exists/.test(error.message));
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "Unknown column",
    header: ["Datum", "Betrag"]
  }), z.ZodError);
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "Unknown key",
    header: ["Other"],
    columns: {},
    extra: true
  }), z.ZodError);
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "Shared column",
    columns: {
      date: 0,
      amount: 1,
      payee: 1
    }
  }), z.ZodError);
  await assert.rejects(createTemplate({
    ...savedInput,
    name: "Bad format",
    header: ["A"],
    columns: {},
    settings: {
      dateFormat: "YYYYMMDD"
    }
  }), z.ZodError);
});

test("a repeated header name keeps its role on the same occurrence", () => {
  const header = ["Date", "Amount", "Payee", "Amount"];
  const mapping = {
    ...suggestMapping(header),
    amount: 3
  };
  const stored: CsvTemplate = {
    ...templateFromMapping("Two amounts", header, mapping, {
      encoding: "utf-8",
      delimiter: ",",
      decimal: ".",
      dateFormat: "YYYY-MM-DD"
    }, {}, {}),
    id: "two",
    builtIn: false
  };

  assert.equal(templateMapping(stored, header).amount, 3);
  assert.deepEqual(mapRows([["2024-01-02", "-1.00", "Example payee", "-2.50"]], templateMapping(stored, header), {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  }, "en").rows.map(row => row.amount), ["-2.50"]);
});

test("remembered choices apply once accounts and categories load, and never override the person's choice", () => {
  const template = {
    accounts: {
      "Example Card": "card"
    },
    categories: {
      "Dining,Travel": "dining"
    }
  };
  const value = {
    value: "Dining,Travel",
    rows: 1,
    multiTag: true,
    matchId: null
  };
  const notLoaded = templateChoices(template, [], []);

  assert.deepEqual(resolveTargets(["Example Card"], new Map(), notLoaded.targets, []).get("Example Card"), {
    kind: "unset"
  });
  assert.deepEqual(resolveCategories([value], new Map(), notLoaded.selections).get(value.value), {
    action: "unset"
  });

  const loaded = templateChoices(template, [{
    id: "card",
    name: "Travel card",
    currency: "EUR"
  }], [{
    id: "dining"
  }]);

  assert.deepEqual(resolveTargets(["Example Card"], new Map(), loaded.targets, []).get("Example Card"), {
    kind: "existing",
    accountId: "card"
  });
  assert.deepEqual(resolveCategories([value], new Map(), loaded.selections).get(value.value), {
    action: "existing",
    categoryId: "dining"
  });

  const chosen = new Map<string, TargetChoice>([["Example Card", {
    kind: "skip"
  }]]);

  assert.deepEqual(resolveTargets(["Example Card"], chosen, loaded.targets, []).get("Example Card"), {
    kind: "skip"
  });
});

test("the built-in Buxfer template is listed after saved ones, cannot be renamed or deleted, and can be duplicated", async context => {
  await isolatedDatabase(context);

  const [listed] = await readTemplates();

  assert.equal(listed.id, buxferTemplate.id);
  assert.equal(templateLabel(listed), "Buxfer export (built-in)");
  await assert.rejects(changeTemplate(buxferTemplate.id, {
    name: "Renamed"
  }), (error: unknown) => error instanceof HttpError && error.status === 409);
  await assert.rejects(removeTemplate(buxferTemplate.id), (error: unknown) => error instanceof HttpError && error.status === 409);

  const { id } = await duplicateTemplate(buxferTemplate.id, {
    name: "Buxfer export (copy)"
  });
  const templates = await readTemplates();

  assert.deepEqual(templates.map(template => [template.id, template.builtIn]), [[id, false], [buxferTemplate.id, true]]);
  assert.deepEqual({
    ...templates[0],
    id: undefined,
    name: undefined,
    builtIn: undefined
  }, {
    ...buxferTemplate,
    id: undefined,
    name: undefined,
    builtIn: undefined
  });
  // The editable copy now wins for Buxfer files.
  assert.equal(matchTemplate(buxferTemplate.header, templates)?.id, id);
  await changeTemplate(id, {
    name: "My Buxfer"
  });
  await assert.rejects(duplicateTemplate("missing", {
    name: "Other"
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
});

test("Buxfer transfers import as transfers, and automatic pairing links both sides", async context => {
  const db = await isolatedDatabase(context);
  const {
    header,
    rows,
    template,
    settings
  } = readBuxfer();
  const mapped = mapRows(rows, templateMapping(template!, header), settings, "en").rows;

  assert.deepEqual(mapped.map(row => row.transfer), [false, false, false, true, true, false]);

  for (const [id, name] of [["checking", "Example Checking"], ["card", "Example Card"]]) {
    await db.insert(schema.accounts).values({
      id,
      name,
      institution: "Example institution",
      kind: "checking"
    });
  }

  const targets = [{
    source: "Example Checking",
    account_id: "checking"
  }, {
    source: "Example Card",
    account_id: "card"
  }];

  await importMappedRows({
    import_id: "00000000-0000-4000-8000-000000000206",
    rows: assignOccurrences(mapped, source => source),
    targets,
    confirm: true
  });

  const saved = await db.select().from(schema.transactions);
  const transfers = saved.filter(row => row.type === "transfer");

  assert.deepEqual(transfers.map(row => row.amount_minor).sort((left, right) => left - right), [-10000, 10000]);
  assert.ok(transfers[0].transfer_id);
  assert.equal(transfers[0].transfer_id, transfers[1].transfer_id);
  assert.ok(transfers.every(row => row.type_source === "auto"));
  assert.equal(saved.find(row => row.amount_minor === -4210)?.type, "expense");
});

test("an offered template keeps the encoding and delimiter the person corrected", () => {
  const detected: CsvSettings = {
    encoding: "utf-8",
    delimiter: ";",
    decimal: ",",
    dateFormat: "DD.MM.YYYY"
  };
  const corrected: CsvSettings = {
    ...detected,
    encoding: "windows-1252",
    delimiter: ","
  };

  assert.deepEqual(templateSettings(buxferTemplate, detected, corrected), {
    encoding: "windows-1252",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });
  assert.deepEqual(templateSettings(buxferTemplate, detected, null), {
    encoding: "utf-8",
    delimiter: ";",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });
});

test("a generic Type column is not guessed as a transfer marker, while the Buxfer template maps it", () => {
  assert.equal(suggestMapping(["Date", "Amount", "Description", "Type"]).type, null);
  assert.equal(templateMapping(buxferTemplate, buxferTemplate.header).type, buxferTemplate.header.indexOf("Type"));
});

test("a template write that loses a uniqueness race is a conflict, not a server error", async context => {
  const db = await isolatedDatabase(context);
  const row = {
    id: "first",
    name: "Race",
    name_key: "race",
    header_key: "[\"Date\"]",
    definition: "{}",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z"
  };

  await db.insert(schema.importTemplates).values(row);
  await assert.rejects(uniqueWrite(db.insert(schema.importTemplates).values({
    ...row,
    id: "second",
    header_key: "[\"Other\"]"
  })), (error: unknown) => error instanceof HttpError && error.status === 409 && /name already exists/.test(error.message));
  await assert.rejects(uniqueWrite(db.insert(schema.importTemplates).values({
    ...row,
    id: "third",
    name_key: "other"
  })), (error: unknown) => error instanceof HttpError && error.status === 409 && /already covers/.test(error.message));
});
