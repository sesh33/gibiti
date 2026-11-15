import { expect, it } from "vitest";
import { luminousEligible, luminousResolution } from "@/lib/luminous-quality";

it("uses a bounded half-resolution field instead of native display pixels", () => {
  expect(luminousResolution(1440, 1000, 1)).toEqual({
    width: 720,
    height: 500,
    pixels: 360000,
  });
  expect(luminousResolution(1440, 1000, 3)).toEqual(
    luminousResolution(1440, 1000, 1.25),
  );
});

it("bounds high-DPI, ultrawide and adversarial sizes while preserving ordinary aspect ratios", () => {
  for (const [width, height, dpr] of [
    [3840, 2160, 4],
    [7680, 4320, 2],
    [1e300, 1e300, 1e300],
    [1e6, 1, 1.25],
    [1, 1e6, 1.25],
  ]) {
    const surface = luminousResolution(width, height, dpr);
    expect(surface.pixels).toBeLessThanOrEqual(420000);
    expect(surface.width).toBeLessThanOrEqual(2048);
    expect(surface.height).toBeLessThanOrEqual(2048);
    expect(
      Number.isSafeInteger(surface.width) &&
        Number.isSafeInteger(surface.height),
    ).toBe(true);
    expect(surface.width).toBeGreaterThanOrEqual(1);
    expect(surface.height).toBeGreaterThanOrEqual(1);
  }
  const wide = luminousResolution(3840, 2160, 3);
  expect(wide.width / wide.height).toBeCloseTo(3840 / 2160, 2);
});

it("can reduce quality without escaping budgets or accepting non-finite configuration", () => {
  const full = luminousResolution(1440, 1000, 1);
  expect(luminousResolution(1440, 1000, 1, 0.6).pixels).toBeLessThan(
    full.pixels,
  );
  expect(luminousResolution(1440, 1000, 1, -1)).toEqual(
    luminousResolution(1440, 1000, 1, 0.35),
  );
  expect(luminousResolution(1440, 1000, 1, 5)).toEqual(full);
  expect(luminousResolution(1440, 1000, NaN, Infinity)).toEqual(full);
  for (const invalid of [0, -1, NaN, Infinity]) {
    expect(luminousResolution(invalid, 1000, 1)).toEqual({
      width: 1,
      height: 1,
      pixels: 1,
    });
    expect(luminousResolution(1440, invalid, 1)).toEqual({
      width: 1,
      height: 1,
      pixels: 1,
    });
  }
});

it("requires every visibility, motion, input and data-saving condition before starting GPU work", () => {
  const normal = {
    width: 1440,
    reduced: false,
    finePointer: true,
    saveData: false,
    visible: true,
  };
  expect(luminousEligible(normal)).toBe(true);
  for (const constraints of [
    { width: 820 },
    { width: 390 },
    { width: NaN },
    { width: Infinity },
    { reduced: true },
    { finePointer: false },
    { saveData: true },
    { visible: false },
  ])
    expect(luminousEligible({ ...normal, ...constraints })).toBe(false);
});
