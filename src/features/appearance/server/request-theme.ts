import { cookies } from "next/headers";
import { parseThemePreference, themeCookieName } from "@/features/appearance/theme-preference";

/** The theme preference this browser sent with the request. */
export async function requestThemePreference() {
  const cookieStore = await cookies();

  return parseThemePreference(cookieStore.get(themeCookieName)?.value);
}
