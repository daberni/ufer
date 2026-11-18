import { redirect } from "next/navigation";
import { bankConnectionsHref } from "@/features/banking/connections-location";

export default function Page() {
  redirect(bankConnectionsHref);
}
