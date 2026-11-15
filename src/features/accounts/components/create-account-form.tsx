"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Plus } from "lucide-react";
import { kinds } from "@/features/dashboard/presentation";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "submit">;

export function CreateAccountForm({
  busy,
  submit
}: Props) {
  return (
    <form
      onSubmit={event => submit(event, async data => {
        await api("accounts", Object.fromEntries(data));
      }, "Asset created.")}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Keep investment values and settlement cash separate to avoid counting the same assets twice.</p>
      <label>
        Name
        <input
          name="name"
          required
          maxLength={100}
          placeholder="e.g. Investment portfolio"
        />
      </label>
      <div className={ui["form-grid"]}>
        <label>
          Institution
          <input
            name="institution"
            required
            maxLength={100}
            placeholder="e.g. Example institution"
          />
        </label>
        <label>
          Type
          <select name="kind">
            {Object.entries(kinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={ui["form-grid"]}>
        <label>
          Current balance
          <input
            name="balance"
            required
            inputMode="decimal"
            pattern="[+-]?[0-9]+([.][0-9]+)?"
            placeholder="0.00"
          />
        </label>
        <label>
          Currency
          <select name="currency">
            <option>EUR</option>
            <option>USD</option>
            <option>CHF</option>
            <option>GBP</option>
          </select>
        </label>
      </div>
      <p className={ui["form-hint"]}>Use a decimal point. Enter outstanding debt as a negative balance.</p>
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={busy}>
        Create asset <Plus size={16} />
      </button>
    </form>
  );
}
