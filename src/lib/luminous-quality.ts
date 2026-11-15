const maxPixels = 420_000;
const maxEdge = 2048;

/** Bound a decorative drawing surface independently of display resolution. */
export function luminousResolution(
  width: number,
  height: number,
  dpr: number,
  quality = 1,
): { width: number; height: number; pixels: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return { width: 1, height: 1, pixels: 1 };
  const density =
    Number.isFinite(dpr) && dpr > 0 ? Math.min(1.25, Math.max(0.5, dpr)) : 1;
  const fidelity = Number.isFinite(quality)
    ? Math.min(1, Math.max(0.35, quality))
    : 1;
  // Cap input magnitudes before multiplication, including hostile/non-browser callers.
  const requestedWidth = Math.min(width, 1_000_000) * 0.5 * density * fidelity;
  const requestedHeight =
    Math.min(height, 1_000_000) * 0.5 * density * fidelity;
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (requestedWidth * requestedHeight)),
    maxEdge / requestedWidth,
    maxEdge / requestedHeight,
  );
  const drawingWidth = Math.max(1, Math.floor(requestedWidth * scale));
  const drawingHeight = Math.max(1, Math.floor(requestedHeight * scale));
  return {
    width: drawingWidth,
    height: drawingHeight,
    pixels: drawingWidth * drawingHeight,
  };
}

/** The optional GPU field never starts for quiet, hidden or constrained views. */
export function luminousEligible({
  width,
  reduced,
  finePointer,
  saveData,
  visible,
}: {
  width: number;
  reduced: boolean;
  finePointer: boolean;
  saveData: boolean;
  visible: boolean;
}) {
  return (
    Number.isFinite(width) &&
    width > 820 &&
    !reduced &&
    finePointer &&
    !saveData &&
    visible
  );
}
