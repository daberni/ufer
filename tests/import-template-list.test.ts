import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent } from "@testing-library/react";
import { render } from "./fixtures/intl";
import { createElement } from "react";
import type { CsvTemplate } from "../src/features/imports/csv-templates";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";
import { queryKeys } from "../src/client/query-keys";

stubCssModules();

const saved: CsvTemplate = {
  id: "saved/1",
  name: "Bank export",
  builtIn: false,
  header: ["Date", "Amount", "Payee"],
  settings: {},
  columns: {
    date: 0,
    amount: 1,
    payee: 2
  },
  accounts: {},
  categories: {}
};

async function loadTemplateList() {
  const { TemplateList } = await import("../src/features/imports/components/template-list");

  return TemplateList;
}

test("a deleted template is reported to the draft only after the server deleted it", async context => {
  const environment = browser(context);
  const TemplateList = await loadTemplateList();
  const deleted: string[] = [];

  environment.queryClient.setQueryData(queryKeys.importTemplates(), [saved]);
  const screen = render(withQueryClient(environment.queryClient, createElement(TemplateList, {
    templates: [saved],
    disabled: false,
    onDeleted: (id: string) => deleted.push(id)
  })));
  const confirmDelete = async (response: Response) => {
    act(() => fireEvent.click(screen.getByRole("button", {
      name: "Delete"
    })));
    act(() => fireEvent.click(screen.getByRole("button", {
      name: "Delete “Bank export”"
    })));
    await wait(0);
    const request = environment.requests("imports/templates/saved%2F1").at(-1);

    assert.equal(request?.method, "DELETE");
    await respond(request, response);
  };

  await confirmDelete(Response.json({
    detail: "Template not found.",
    status: 404
  }, {
    status: 404
  }));
  assert.deepEqual(deleted, []);

  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Keep"
  })));
  await confirmDelete(Response.json({
    ok: true
  }));
  assert.deepEqual(deleted, ["saved/1"]);
  // A failed or pending refetch must not offer the deleted template again.
  assert.deepEqual(environment.queryClient.getQueryData(queryKeys.importTemplates()), []);
});

test("renaming starts from the current name, also after an earlier rename", async context => {
  const environment = browser(context);
  const TemplateList = await loadTemplateList();
  const list = (template: CsvTemplate) => withQueryClient(environment.queryClient, createElement(TemplateList, {
    templates: [template],
    disabled: false
  }));
  const screen = render(list(saved));
  const startRename = () => act(() => fireEvent.click(screen.getByRole("button", {
    name: "Rename"
  })));

  startRename();
  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Template name"
    }), {
      target: {
        value: "Typed but cancelled"
      }
    });
  });
  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Cancel"
  })));
  screen.rerender(list({
    ...saved,
    name: "Renamed elsewhere"
  }));
  startRename();

  assert.equal((screen.getByRole("textbox", {
    name: "Template name"
  }) as HTMLInputElement).value, "Renamed elsewhere");
});
