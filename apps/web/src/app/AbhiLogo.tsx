/**
 * The ABHI Microfinance Bank lockup.
 *
 * Drawn as inline SVG rather than loaded as an image, for three reasons that
 * all matter here: it stays crisp at every size and on a projector, it recolours
 * from the same tokens as the rest of the chrome, and it cannot 404. The
 * previous mark pointed at `/abhi-mark.png` in a `public/` directory that does
 * not exist in this repository, so it silently rendered its fallback tile on
 * every single page load.
 *
 * Three brand elements, all from the master artwork:
 *
 *   - the "A" monogram, its lower right dissolving into a mosaic of squares;
 *   - a vertical mint rule separating monogram from wordmark;
 *   - the wordmark, with "microfinance bank" justified to the lockup's width.
 *
 * The mosaic is the reason mint appears anywhere in this UI. It is the brand's
 * own geometric gesture, so the accent squares in the interface are a quotation
 * from the logo rather than decoration invented for the console.
 */

/** Mosaic cells, as [column, row] on a 4x4 grid. Mirrors the master artwork. */
const MOSAIC: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [0, 3],
  [1, 3],
  [3, 3],
];

const CELL = 3.4;
const PITCH = 4.6;
const ORIGIN_X = 21.5;
const ORIGIN_Y = 19;

function Monogram() {
  return (
    <>
      {/*
        The "A": two legs meeting at an apex, with the inner counter cut out.
        No crossbar — the mosaic occupies that optical space instead, which is
        what gives the mark its "under construction / being built" read.
      */}
      <path
        d="M23.5 4.5 L27.5 4.5 L45 39 L37.6 39 L25.5 14.2 L13.4 39 L6 39 Z"
        fill="currentColor"
      />
      {MOSAIC.map(([c, r]) => (
        <rect
          key={`${c}-${r}`}
          x={ORIGIN_X + c * PITCH}
          y={ORIGIN_Y + r * PITCH}
          width={CELL}
          height={CELL}
          rx={0.5}
          fill="var(--abhi-mint-500)"
        />
      ))}
    </>
  );
}

/**
 * The full lockup: monogram, mint rule, wordmark and descriptor.
 *
 * `title` is the accessible name. Everything inside is aria-hidden so a screen
 * reader announces "ABHI Microfinance Bank" once, rather than spelling out the
 * paths and reading the descriptor as a separate orphaned string.
 */
export function AbhiLogo({
  className = '',
  showDescriptor = true,
}: {
  className?: string;
  /** Drop "microfinance bank" where the lockup has to sit in a short space. */
  showDescriptor?: boolean;
}) {
  return (
    <svg
      viewBox={showDescriptor ? '0 0 158 62' : '0 0 158 44'}
      role="img"
      aria-label="ABHI Microfinance Bank"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g className="text-white" color="#ffffff">
        <Monogram />
      </g>

      {/* The vertical mint rule. */}
      <rect x="53" y="6" width="3" height="33" rx="1.5" fill="var(--abhi-mint-500)" />

      <text
        x="64"
        y="39"
        fill="#ffffff"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="37"
        fontWeight="800"
        letterSpacing="-1"
      >
        ABHI
      </text>

      {/*
        Justified to the lockup: the descriptor starts at the monogram's left
        edge and ends at the wordmark's right edge, exactly as in the master
        artwork. textLength does the work so it holds at any rendered size.
      */}
      {showDescriptor && (
        <text
          x="6"
          y="57"
          fill="#ffffff"
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize="15"
          fontWeight="600"
          textLength="145"
          lengthAdjust="spacingAndGlyphs"
        >
          microfinance bank
        </text>
      )}
    </svg>
  );
}

/** The monogram alone — for favicons, avatars and tight chrome. */
export function AbhiMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 50 44"
      role="img"
      aria-label="ABHI"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g color="#ffffff">
        <Monogram />
      </g>
    </svg>
  );
}
