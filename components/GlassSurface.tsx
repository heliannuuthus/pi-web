"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type GlassBackdropStyle = CSSProperties & {
  "--glass-blur"?: string;
  "--glass-saturation"?: number;
};

export interface GlassSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children?: ReactNode;
  backdropClassName?: string;
  borderRadius?: number;
  blur?: number;
  saturation?: number;
}

/**
 * Apple Liquid Glass rounded capsule surface.
 *
 * Renders the GPU frosted optical plane (`backdrop-filter` + prismatic specular
 * rim) as an absolute sibling leaf rather than an ancestor of `children`, so
 * `position: fixed` popovers and menus inside toolbars keep the viewport as
 * their containing block and are never clipped. Note: Chromium Skia aborts the
 * entire `backdrop-filter` pipeline when an SVG `<feImage>` data URI is referenced
 * via `url(#...)`, so hardware CSS `backdrop-filter` + convex radial sheen is used
 * across all engines for deterministic 120fps frosted diffusion and color bloom.
 */
export function GlassSurface({
  children,
  className = "",
  backdropClassName = "",
  style,
  borderRadius = 0,
  blur = 24,
  saturation = 1.95,
  ...props
}: GlassSurfaceProps) {
  const backdropStyle: GlassBackdropStyle = {
    borderRadius,
    "--glass-blur": `${blur}px`,
    "--glass-saturation": saturation,
  };

  return (
    <div
      {...props}
      className={`apple-glass-host${className ? ` ${className}` : ""}`}
      style={{ borderRadius: borderRadius || undefined, ...style }}
    >
      <div
        aria-hidden="true"
        className={`apple-glass-backdrop is-frosted${backdropClassName ? ` ${backdropClassName}` : ""}`}
        style={backdropStyle}
      />
      <div className="apple-glass-content">{children}</div>
    </div>
  );
}
