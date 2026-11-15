"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { api } from "@/client/api";
import type { Category } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { CategoryIconPicker } from "./category-icon-picker";

type Props = Pick<DashboardController, "busy" | "submit"> & {
  category?: Category | null;
};

const defaultColor = "#638777";

export function CategoryForm({
  busy,
  category,
  submit
}: Props) {
  return (
    <form
      onSubmit={event => submit(event, async data => {
        const body = Object.fromEntries(data);

        if (category) {
          await api(`categories/${category.id}`, body, "PATCH");
        } else {
          await api("categories", body);
        }
      }, category ? "Category saved." : "Category created.")}
      className={ui["form"]}
    >
      <label>
        Name
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={category?.name}
        />
      </label>
      <label>
        Color
        <input
          name="color"
          type="color"
          required
          defaultValue={category?.color ?? defaultColor}
        />
      </label>
      <CategoryIconPicker defaultIcon={category?.icon ?? null} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Save category
      </button>
    </form>
  );
}
