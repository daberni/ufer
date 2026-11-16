import styles from "./category-icon-picker.module.css";
import { categoryIconKeys, categoryIconLabels, type CategoryIconKey } from "@/features/categorization/category-icons";
import { categoryChipColors, themedColors } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";

type Props = {
  color: string;
  icon: CategoryIconKey | "";
  onChange: (icon: CategoryIconKey | "") => void;
};

export function CategoryIconPicker({
  color,
  icon,
  onChange
}: Props) {
  const { foreground: iconColor } = themedColors(scheme => categoryChipColors(color, scheme));

  return (
    <fieldset className={styles["icon-picker"]}>
      <legend>Icon</legend>
      <div className={styles["icon-options"]}>
        <label className={styles["icon-option"]} title="No icon">
          <input
            className={styles["icon-input"]}
            type="radio"
            name="icon"
            value=""
            checked={icon === ""}
            onChange={() => onChange("")}
          />
          <span
            className={styles["no-icon"]}
            aria-hidden="true"
            style={{
              background: iconColor
            }}
          />
          <span className={styles["icon-label"]}>No icon</span>
        </label>
        {categoryIconKeys.map(key => {
          const Icon = categoryIconComponents[key];

          return (
            <label className={styles["icon-option"]} key={key} title={categoryIconLabels[key]}>
              <input
                className={styles["icon-input"]}
                type="radio"
                name="icon"
                value={key}
                checked={icon === key}
                onChange={() => onChange(key)}
              />
              <Icon
                aria-hidden="true"
                size={18}
                style={{
                  color: iconColor
                }}
              />
              <span className={styles["icon-label"]}>{categoryIconLabels[key]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
