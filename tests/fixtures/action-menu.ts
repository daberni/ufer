import { act, fireEvent, type RenderResult } from "@testing-library/react";
import { wait } from "./browser";

type Screen = Pick<RenderResult, "getByRole" | "queryByRole">;

// jsdom has no popover API, so the open menu's top-layer content counts as hidden to role queries.

async function openMenu(screen: Screen) {
  const trigger = screen.getByRole("button", {
    name: /^Actions for /
  });

  if (trigger.getAttribute("aria-expanded") !== "true") {
    act(() => fireEvent.click(trigger));
    await wait(0);
  }
}

/** Opens the "…" menu if needed and returns its entry with this name. */
export async function menuItem(screen: Screen, name: string) {
  await openMenu(screen);

  return screen.getByRole("menuitem", {
    name,
    hidden: true
  });
}

/** Opens the "…" menu if needed and returns its entry with this name, or null. */
export async function queryMenuItem(screen: Screen, name: string) {
  await openMenu(screen);

  return screen.queryByRole("menuitem", {
    name,
    hidden: true
  });
}

/** Opens the "…" menu if needed and chooses its entry with this name. */
export async function chooseMenuItem(screen: Screen, name: string) {
  const item = await menuItem(screen, name);

  act(() => fireEvent.click(item));
}
