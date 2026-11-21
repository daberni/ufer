import { useId } from "react";

type Props = {
  /** The line's path, drawn left to right across a 0–100 wide plot. */
  line: string;
  /** The plot's vertical extent in viewBox units. */
  height: number;
  /** The zero level in viewBox units, or null to fill down to the plot's bottom edge in one color. */
  zero: number | null;
  areaClassName: string;
  lineClassName: string;
  positiveClassName: string;
  negativeClassName: string;
  zeroClassName: string;
};

/** An area chart's fill and line; when the series crosses zero, the parts above and below a solid zero line take their own classes. */
export function SignedArea({
  line,
  height,
  zero,
  areaClassName,
  lineClassName,
  positiveClassName,
  negativeClassName,
  zeroClassName
}: Props) {
  const id = useId();

  if (zero === null) {
    return (
      <>
        <path className={areaClassName} d={`${line} L100,${height} L0,${height} Z`} />
        <path className={lineClassName} d={line} vectorEffect="non-scaling-stroke" />
      </>
    );
  }

  const area = `${line} L100,${zero} L0,${zero} Z`;
  const above = `${id}-above`;
  const below = `${id}-below`;

  // Clip regions extend past the plot so strokes at its edges are not cut.
  return (
    <>
      <defs>
        <clipPath id={above}>
          <rect
            x={-10}
            y={-height}
            width={120}
            height={zero + height}
          />
        </clipPath>
        <clipPath id={below}>
          <rect
            x={-10}
            y={zero}
            width={120}
            height={2 * height}
          />
        </clipPath>
      </defs>
      <g className={positiveClassName} clipPath={`url(#${above})`}>
        <path className={areaClassName} d={area} />
        <path className={lineClassName} d={line} vectorEffect="non-scaling-stroke" />
      </g>
      <g className={negativeClassName} clipPath={`url(#${below})`}>
        <path className={areaClassName} d={area} />
        <path className={lineClassName} d={line} vectorEffect="non-scaling-stroke" />
      </g>
      <line
        className={zeroClassName}
        x1={0}
        x2={100}
        y1={zero}
        y2={zero}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}
