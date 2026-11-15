import { clsx } from "clsx";
import type { ReactNode } from "react";
import styles from "./illustrations.module.css";

type IllustrationProps = {
  className?: string;
};

type FrameProps = IllustrationProps & {
  viewBox: string;
  preserveAspectRatio?: string;
  children: ReactNode;
};

// Illustrations are decorative: adjacent text always carries the meaning, so assistive technology skips them.
function IllustrationFrame({
  className,
  viewBox,
  preserveAspectRatio,
  children
}: FrameProps) {
  return (
    <svg
      className={clsx(styles["illustration"], className)}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A calm cove between two banks; the general empty-state illustration. */
export function ShoreIllustration({
  className
}: IllustrationProps) {
  return (
    <IllustrationFrame className={className} viewBox="0 0 160 96">
      <path className={styles["sun"]} d="M91 30a9 9 0 0 0 18 0 9 9 0 0 0-18 0" />
      <path className={styles["line"]} d="M52 24q4-4 8 0q4-4 8 0" />
      <path className={styles["water"]} d="M12 62h136c0 16-30 28-68 28S12 78 12 62z" />
      <path className={styles["land"]} d="M12 62c6-14 18-26 32-26 16 0 26 12 34 26z" />
      <path className={styles["land-shade"]} d="M26 62c6-8 12-11 20-11 9 0 16 4 22 11z" />
      <path className={styles["land"]} d="M96 62c8-10 20-16 30-16s18 6 22 16z" />
      <path className={styles["line"]} d="M58 72c6-3 12-3 18 0s12 3 18 0" />
      <path className={styles["line"]} d="M76 81c5-2.5 10-2.5 15 0s10 2.5 15 0" />
    </IllustrationFrame>
  );
}

/** A footbridge joining two banks; illustrates the first bank connection. */
export function BridgeIllustration({
  className
}: IllustrationProps) {
  return (
    <IllustrationFrame className={className} viewBox="0 0 160 96">
      <path className={styles["sun"]} d="M121 22a7 7 0 0 0 14 0 7 7 0 0 0-14 0" />
      <path className={styles["water"]} d="M12 62h136c0 16-30 28-68 28S12 78 12 62z" />
      <path className={styles["land"]} d="M12 62c8-12 20-18 34-18 12 0 18 10 22 18z" />
      <path className={styles["land"]} d="M92 62c4-8 10-18 22-18 14 0 26 6 34 18z" />
      <path className={styles["structure"]} d="M50 54q30-24 60 0M50 44q30-24 60 0M62 46.3v-10M80 42V32m18 14.3v-10" />
      <path className={styles["line"]} d="M64 74c5-3 10-3 15 0s10 3 15 0" />
      <path className={styles["line"]} d="M86 82c4-2 8-2 12 0s8 2 12 0" />
    </IllustrationFrame>
  );
}

/** A wide, low shoreline anchored to the bottom edge of a full-page surface. */
export function ShorelineBackdrop({
  className
}: IllustrationProps) {
  return (
    <IllustrationFrame className={className} viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice">
      <path className={styles["sun"]} d="M834 104a26 26 0 0 0 52 0 26 26 0 0 0-52 0" />
      <path className={styles["land-far"]} d="M0 150c120-40 240-46 360-26s200-6 320-20 260 8 360 26c70 12 120 6 160-2v112H0z" />
      <path className={styles["water"]} d="M0 178c200-8 400-6 600-2s400 4 600-8v72H0z" />
      <path className={styles["land"]} d="M0 160c80-10 170-4 250 16 50 12 80 28 90 64H0z" />
      <path className={styles["land"]} d="M1200 150c-90-4-180 10-240 36-40 18-60 36-64 54h304z" />
      <path className={styles["line"]} d="M480 204c20-8 40-8 60 0s40 8 60 0" />
      <path className={styles["line"]} d="M640 222c16-6 32-6 48 0s32 6 48 0" />
    </IllustrationFrame>
  );
}
