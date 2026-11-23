import type { Language } from "@/lib/language";
import type { Messages } from "@/messages";

declare module "next-intl" {
  interface AppConfig {
    Locale: Language | (string & {});
    Messages: Messages;
  }
}
