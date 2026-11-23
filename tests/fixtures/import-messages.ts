import { createTranslator } from "next-intl";
import { messagesFor } from "../../src/messages";
import type { ImportMessages } from "../../src/features/imports/import-messages";

/** The English `imports` messages that word row and field problems, as components hand them to the import modules. */
export const importMessages = createTranslator({
  locale: "en",
  messages: messagesFor("en"),
  namespace: "imports"
}) as unknown as ImportMessages;
