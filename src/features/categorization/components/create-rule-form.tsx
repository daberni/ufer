"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Sparkles } from "lucide-react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";

type Props = Pick<DashboardController, "busy" | "state" | "submit">;

export function CreateRuleForm({
  busy,
  state,
  submit
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <form
      onSubmit={event => submit(event, async data => {
        await api("rules", {
          ...Object.fromEntries(data),
          priority: Number(data.get("priority"))
        });
      }, "Rule created. New transactions will be categorized automatically.")}
      className={ui["form"]}
    >
      <label>
        Rule name
        <input
          name="name"
          required
          placeholder="e.g. Groceries"
          maxLength={100}
        />
      </label>
      <label>
        Matching pattern
        <input
          name="pattern"
          required
          placeholder="e.g. MARKET"
          maxLength={500}
        />
      </label>
      <div className={ui["form-grid"]}>
        <label>
          Match type
          <Select name="mode">
            <option value="keyword">Contains keyword</option>
            <option value="regex">Regular expression (RE2)</option>
          </Select>
        </label>
        <label>
          Priority
          <input
            name="priority"
            type="number"
            min="0"
            max="10000"
            defaultValue="100"
            required
          />
        </label>
      </div>
      <label>
        Category
        <Select name="category_id" required>
          {state?.categories.map(category => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </label>
      <p className={ui["form-hint"]}>Matches the payee and description without case sensitivity. The first matching rule wins.</p>
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Create rule <Sparkles size={16} />
      </button>
    </form>
  );
}
