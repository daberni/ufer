import Image from "next/image";
import icon from "./ufer-icon.svg";
import styles from "./brand-icon.module.css";

type Props = {
  size?: number;
  label?: string;
};

export function BrandIcon({
  size = 36,
  label = ""
}: Props) {
  return (
    <Image
      src={icon}
      alt={label}
      aria-hidden={label ? undefined : true}
      width={size}
      height={size}
      className={styles.icon}
      unoptimized
    />
  );
}
