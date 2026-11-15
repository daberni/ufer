import { z } from "zod";
import { validDate } from "@/lib/money";

export const accountInput = z.object({
  name: z.string().trim().min(1).max(100),
  institution: z.string().trim().min(1).max(100),
  kind: z.enum(["checking", "savings", "investment", "loan", "property", "credit_card"]),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  balance: z.string().max(30)
});

export const valuationInput = z.object({
  balance: z.string().max(30),
  date: z.string().refine(validDate)
});

export type ManualAccountInput = z.infer<typeof accountInput>;
