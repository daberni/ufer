import styles from "./source-code-notice.module.css";

/** SPDX identifier of the license in the repository's LICENSE file. */
const projectLicense = "AGPL-3.0-or-later";

/** Offered on every screen of the application, including sign-in and failed loads, so all remote users can obtain the source. */
export function SourceCodeNotice({
  className,
  url
}: {
  className?: string;
  url: string | null;
}) {
  if (!url) {
    return <span className={className}>{projectLicense}</span>;
  }

  return (
    <span className={className}>
      <a className={styles["link"]} href={url} rel="noreferrer">
        Source code
      </a>{" "}
      · {projectLicense}
    </span>
  );
}
