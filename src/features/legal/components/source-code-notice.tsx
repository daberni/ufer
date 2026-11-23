import { useTranslations } from "next-intl";
import styles from "./source-code-notice.module.css";

/** SPDX identifier of the license in the repository's LICENSE file. */
const projectLicense = "AGPL-3.0-or-later";

/**
 * Where users obtain the Corresponding Source, as AGPL-3.0 section 13 requires for network use. A modified deployment must change this to its own source.
 */
export const sourceCodeUrl = "https://github.com/daberni/ufer";

/** Offered on every screen of the application, including sign-in and failed loads, so all remote users can obtain the source. */
export function SourceCodeNotice({ className }: {
  className?: string
}) {
  const t = useTranslations("legal");

  return (
    <span className={className}>
      <a className={styles["link"]} href={sourceCodeUrl} rel="noreferrer">
        {t("sourceCode")}
      </a>{" "}
      · {projectLicense}
    </span>
  );
}
