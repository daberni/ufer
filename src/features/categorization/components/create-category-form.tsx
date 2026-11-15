"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "submit">;

export function CreateCategoryForm({
  busy,
  submit
}: Props) {
  return (
    <form
      onSubmit={event => submit(event, async data => {
        await api("categories", Object.fromEntries(data));
      }, "Category created.")}
      className={ui["form"]}
    >
      <label>
        Name
        <input name="name" required maxLength={100} />
      </label>
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Save category
      </button>
    </form>
  );
}
