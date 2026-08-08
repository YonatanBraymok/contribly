import {
  BRAND_CELLS,
  CELL_GAP,
  CELL_RADIUS,
  CELL_SIDE,
  LOCKUP_HEIGHT,
  LOCKUP_WIDTH,
  MARK_WIDTH,
  WORDMARK_PATH,
} from "./brand";

const PITCH = CELL_SIDE + CELL_GAP;

type LogoProps = {
  /** `full` pairs the mark with the wordmark; `mark` is the squares alone. */
  variant?: "full" | "mark";
  className?: string;
  /**
   * Set when the logo is the only thing naming the brand. Pass `null` where a
   * visible label already says "Contribly", so screen readers hear it once.
   */
  label?: string | null;
};

/**
 * The Contribly logo: a GitHub contribution-graph ramp, from an empty day
 * through four levels of activity.
 *
 * The squares carry fixed brand colours. The wordmark is filled with
 * `currentColor` so it inherits the surrounding text colour and stays legible
 * in both themes.
 */
export function Logo({
  variant = "full",
  className,
  label = "Contribly",
}: LogoProps) {
  const isFull = variant === "full";

  return (
    <svg
      viewBox={`0 0 ${isFull ? LOCKUP_WIDTH : MARK_WIDTH} ${
        isFull ? LOCKUP_HEIGHT : CELL_SIDE
      }`}
      className={className}
      role={label ? "img" : "presentation"}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {BRAND_CELLS.map((fill, index) => (
        <rect
          key={fill}
          x={index * PITCH}
          y={0}
          width={CELL_SIDE}
          height={CELL_SIDE}
          rx={CELL_RADIUS}
          fill={fill}
        />
      ))}
      {isFull && (
        <path d={WORDMARK_PATH} fill="currentColor" fillRule="evenodd" />
      )}
    </svg>
  );
}
