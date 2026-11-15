"use client";

import { useEffect, useRef } from "react";
import { luminousEligible, luminousResolution } from "@/lib/luminous-quality";
import { useVisualEffects } from "@/lib/visual-effects";

// A small analytic field, not a ray marcher. Three folded ribbons and their
// caustic rims provide depth with a fixed, predictable fragment cost.
const vertexSource = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;
const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;

vec3 ribbon(vec2 p, float time, float phase, vec3 pigment) {
  float wave = sin(p.x * 0.94 + time + phase) * 0.24
    + sin(p.x * 1.71 - time * 0.63 + phase * 1.9) * 0.105;
  float d = p.y - wave - phase * 0.19;
  float envelope = exp(-abs(d) * 6.3);
  float rim = exp(-d * d * 680.0);
  float fold = 0.5 + 0.5 * sin(p.x * 1.48 - time * 0.56 + phase);
  float specular = pow(fold, 9.0) * rim;
  float dispersion = exp(-pow(d + 0.023, 2.0) * 1350.0);
  vec3 body = pigment * envelope * (0.055 + fold * 0.09);
  vec3 edge = pigment * rim * 0.19 + vec3(0.23, 0.42, 0.55) * specular * 0.24;
  return body + edge + pigment.bgr * dispersion * 0.025;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  vec2 p = (uv - 0.5) * 2.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  p.x *= aspect;
  vec2 pointer = (uPointer - 0.5) * vec2(2.0 * aspect, 2.0);
  vec2 delta = p - pointer;
  float lens = exp(-dot(delta, delta) * 2.7);
  p += delta * lens * 0.065;
  p = mat2(0.91, -0.4146, 0.4146, 0.91) * p;
  float time = uTime * 0.085;
  p.y += sin(p.x * 0.63 + time * 0.42) * 0.09;

  vec3 light = ribbon(p + vec2(0.0, -0.21), time, 0.2, vec3(0.22, 0.41, 0.98));
  light += ribbon(p + vec2(0.18, 0.1), time * 0.88, 1.7, vec3(0.10, 0.69, 0.88));
  light += ribbon(p + vec2(-0.25, 0.46), time * 0.73, -1.8, vec3(0.57, 0.32, 0.94));
  float glow = exp(-length(p - vec2(0.67, 0.12)) * 1.35);
  light += vec3(0.035, 0.075, 0.17) * glow;
  light += vec3(0.012, 0.025, 0.055) * lens;
  float vignette = 1.0 - smoothstep(0.18, 1.12, length(uv - vec2(0.55, 0.53)));
  light *= vignette;
  light = vec3(1.0) - exp(-light * 1.35);
  // Static sub-byte dither reduces gradient banding without animated noise.
  float dither = (fract(sin(dot(mod(gl_FragCoord.xy, 64.0), vec2(12.9898, 78.233))) * 4375.8545) - 0.5) / 255.0;
  gl_FragColor = vec4(max(light + dither, vec3(0.0)), 1.0);
}
`;

type DrawingResources = {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  position: number;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
  pointer: WebGLUniformLocation;
};
type DataConnection = EventTarget & { readonly saveData?: boolean };

function createDrawing(gl: WebGLRenderingContext): DrawingResources | null {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("No shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Shader unavailable");
    }
    program = gl.createProgram();
    if (!program) throw new Error("No program");
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Program unavailable");
    const position = gl.getAttribLocation(program, "aPosition"),
      resolution = gl.getUniformLocation(program, "uResolution"),
      time = gl.getUniformLocation(program, "uTime"),
      pointer = gl.getUniformLocation(program, "uPointer");
    if (position < 0 || !resolution || !time || !pointer)
      throw new Error("Drawing parameters unavailable");
    buffer = gl.createBuffer();
    if (!buffer) throw new Error("No buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    return { program, buffer, position, resolution, time, pointer };
  } catch {
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    return null;
  } finally {
    // Linked programs retain their compiled shaders until program disposal.
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

/** Optional, bounded GPU lighting. The existing CSS atmosphere is the fallback. */
export function LuminousField() {
  const host = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLCanvasElement>(null);
  const { cinematic } = useVisualEffects();

  useEffect(() => {
    const element = host.current,
      canvas = surface.current;
    if (!element || !canvas) return;
    element.dataset.renderer = "disabled";
    if (!cinematic) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)"),
      precision = window.matchMedia("(hover: hover) and (pointer: fine)"),
      connection = (navigator as Navigator & { connection?: DataConnection })
        .connection;
    let gl: WebGLRenderingContext | null = null,
      drawing: DrawingResources | null = null,
      frame = 0,
      lastDraw = 0,
      elapsed = 0,
      quality = 1,
      interval = 1000 / 30,
      samples = 0,
      slowSamples = 0,
      recoveries = 0,
      lost = false,
      failed = false,
      disposed = false;
    const pointer = { x: 0.72, y: 0.64, targetX: 0.72, targetY: 0.64 };

    function eligible() {
      return (
        !disposed &&
        !failed &&
        !lost &&
        luminousEligible({
          width: window.innerWidth,
          reduced: motion.matches,
          finePointer: precision.matches,
          saveData: Boolean(connection?.saveData),
          visible: !document.hidden,
        })
      );
    }
    function stop(state: string) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastDraw = 0;
      element!.dataset.renderer = state;
    }
    function disposeDrawing() {
      if (!gl || !drawing) return;
      gl.disableVertexAttribArray(drawing.position);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(drawing.buffer);
      gl.deleteProgram(drawing.program);
      drawing = null;
    }
    function fallback() {
      failed = true;
      stop("fallback");
      disposeDrawing();
      canvas!.width = canvas!.height = 1;
    }
    function resize() {
      if (!gl) return;
      const size = luminousResolution(
        window.innerWidth,
        window.innerHeight,
        window.devicePixelRatio,
        quality,
      );
      if (canvas!.width !== size.width || canvas!.height !== size.height) {
        canvas!.width = size.width;
        canvas!.height = size.height;
      }
      gl.viewport(0, 0, size.width, size.height);
      element!.dataset.quality = quality.toFixed(2);
    }
    function draw(timestamp: number) {
      frame = 0;
      if (!eligible() || !gl || !drawing) {
        stop(failed || lost ? "fallback" : "paused");
        return;
      }
      if (lastDraw && timestamp - lastDraw < interval - 0.5) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const delta = lastDraw ? timestamp - lastDraw : interval;
      elapsed += Math.min(delta, 100);
      lastDraw = timestamp;
      const started = performance.now();
      try {
        pointer.x += (pointer.targetX - pointer.x) * 0.07;
        pointer.y += (pointer.targetY - pointer.y) * 0.07;
        gl.useProgram(drawing.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, drawing.buffer);
        gl.enableVertexAttribArray(drawing.position);
        gl.vertexAttribPointer(drawing.position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(drawing.resolution, canvas!.width, canvas!.height);
        gl.uniform1f(drawing.time, (elapsed / 1000) % 3600);
        gl.uniform2f(drawing.pointer, pointer.x, pointer.y);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (element!.dataset.renderer !== "webgl") {
          if (gl.getError() !== gl.NO_ERROR) {
            fallback();
            return;
          }
          element!.dataset.renderer = "webgl";
        }
      } catch {
        fallback();
        return;
      }
      samples++;
      if (delta > 85 || performance.now() - started > 12) slowSamples++;
      if (samples >= 30) {
        if (slowSamples >= 12) {
          if (quality <= 0.55) {
            fallback();
            return;
          }
          quality *= 0.72;
          interval = 1000 / 20;
          resize();
        }
        samples = slowSamples = 0;
      }
      frame = requestAnimationFrame(draw);
    }
    function reconcile() {
      if (!eligible()) {
        stop(failed || lost ? "fallback" : "paused");
        return;
      }
      if (!gl) {
        try {
          gl = canvas!.getContext("webgl", {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "low-power",
            failIfMajorPerformanceCaveat: true,
          });
        } catch {
          fallback();
          return;
        }
        if (!gl) {
          fallback();
          return;
        }
      }
      if (!drawing) {
        drawing = createDrawing(gl);
        if (!drawing) {
          fallback();
          return;
        }
      }
      resize();
      if (!frame) frame = requestAnimationFrame(draw);
    }
    const move = (event: PointerEvent) => {
      if (!eligible() || event.pointerType === "touch") return;
      pointer.targetX = event.clientX / Math.max(1, window.innerWidth);
      pointer.targetY = 1 - event.clientY / Math.max(1, window.innerHeight);
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      drawing = null; // The context has already released its objects.
      stop("fallback");
    };
    const contextRestored = () => {
      if (disposed || ++recoveries > 1) {
        failed = true;
        stop("fallback");
        return;
      }
      lost = false;
      reconcile();
    };

    canvas.addEventListener("webglcontextlost", contextLost);
    canvas.addEventListener("webglcontextrestored", contextRestored);
    window.addEventListener("resize", reconcile, { passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", reconcile);
    motion.addEventListener("change", reconcile);
    precision.addEventListener("change", reconcile);
    connection?.addEventListener?.("change", reconcile);
    reconcile();
    return () => {
      disposed = true;
      stop("disabled");
      window.removeEventListener("resize", reconcile);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", reconcile);
      motion.removeEventListener("change", reconcile);
      precision.removeEventListener("change", reconcile);
      connection?.removeEventListener?.("change", reconcile);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      disposeDrawing();
      // Release the drawing surface without losing a context that may be reused
      // when the visitor turns the preference back on.
      canvas.width = canvas.height = 1;
    };
  }, [cinematic]);

  return (
    <div
      className="luminous-field"
      data-renderer="fallback"
      ref={host}
      aria-hidden="true"
    >
      <canvas ref={surface} width="1" height="1" tabIndex={-1} />
    </div>
  );
}
