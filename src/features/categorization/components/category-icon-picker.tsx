import styles from "./category-icon-picker.module.css";
import { CircleOff } from "lucide-react";
import { categoryIconKeys, categoryIconLabels, isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryIconComponents } from "./category-marker";

type Props = {
  defaultIcon: string | null;
};

export function CategoryIconPicker({
  defaultIcon
}: Props) {
  const selected = isCategoryIcon(defaultIcon) ? defaultIcon : "";

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
            defaultChecked={selected === ""}
          />
          <CircleOff aria-hidden="true" size={18} />
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
                defaultChecked={selected === key}
              />
              <Icon aria-hidden="true" size={18} />
              <span className={styles["icon-label"]}>{categoryIconLabels[key]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
