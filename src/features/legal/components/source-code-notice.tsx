import styles from "./source-code-notice.module.css";

/** SPDX identifier of the license in the repository's LICENSE file. */
const projectLicense = "AGPL-3.0-or-later";

export function SourceCodeNotice({ url }: {
  url: string | null
}) {
  if (!url) {
    return <span>{projectLicense}</span>;
  }

  return (
    <span>
      <a className={styles["link"]} href={url} rel="noreferrer">
        Source code
      </a>{" "}
      · {projectLicense}
    </span>
  );
}
