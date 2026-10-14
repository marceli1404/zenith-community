/** The Zenith mark: the arc of the sky with a point at its highest place. Single
 *  colour (currentColor) so one drawing serves light UI, dark UI, favicon and app icon. */
export function ZenithMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="zenith-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path className="zenith-mark__arc" d="M5 25.5a11 11 0 0 1 22 0" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <circle className="zenith-mark__point" cx="16" cy="14.5" r="3.4" fill="currentColor" />
    </svg>
  );
}
