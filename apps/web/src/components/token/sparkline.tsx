/** Mini price chart for a list row: the coin's recent USD price, green when it is up
 *  over the window and red when down. Nothing is drawn until two points exist. */
export function Sparkline({ points, width = 72, height = 24 }: { points: number[] | undefined; width?: number; height?: number }) {
  if (!points || points.length < 2) {
    return <span className="inline-block font-mono text-[11px] text-muted" style={{ width }} title="Chart builds as prices arrive">—</span>;
  }
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || hi || 1;
  const step = width / (points.length - 1);
  const pad = 2;
  const y = (p: number) => pad + (1 - (p - lo) / span) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join("");
  const up = points[points.length - 1] >= points[0];
  const change = ((points[points.length - 1] / points[0] - 1) * 100).toFixed(1);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 ${up ? "text-positive" : "text-negative"}`}
      role="img"
      aria-label={`Price ${up ? "up" : "down"} ${change}% over the last ${Math.round((points.length * 30) / 60)} minutes`}
    >
      <title>{`${up ? "+" : ""}${change}% over the last ${Math.round((points.length * 30) / 60)} min`}</title>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill="currentColor" opacity="0.1" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
