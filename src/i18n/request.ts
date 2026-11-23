import { getRequestConfig } from "next-intl/server";
import { languageOf } from "@/lib/language";
import { messagesFor } from "@/messages";
import { currentFormatLocale, currentLanguage } from "@/server/http/request-locale";

// Without locale path prefixes the request's cookie and Accept-Language header decide; numbers inside messages use the format locale when it is in the same language.
export default getRequestConfig(async () => {
  const [language, formatLocale] = await Promise.all([currentLanguage(), currentFormatLocale()]);
  const locale = languageOf(formatLocale) === language ? formatLocale : language;

  return {
    locale,
    messages: messagesFor(language)
  };
});
