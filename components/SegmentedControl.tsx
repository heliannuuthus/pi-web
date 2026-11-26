"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface BoxMetric {
  x: number;
  width: number;
}

export interface SegmentedTrackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** "segmented" renders a recessed pill track + spring active thumb; "ghost" renders a magnetic hover glider only. */
  variant?: "segmented" | "ghost";
}

function measureButtonInTrack(track: HTMLElement, button: HTMLElement): BoxMetric | null {
  const trackRect = track.getBoundingClientRect();
  const btnRect = button.getBoundingClientRect();
  if (trackRect.width <= 0 || btnRect.width <= 0) return null;
  return {
    x: Math.round((btnRect.left - trackRect.left - track.clientLeft) * 2) / 2,
    width: Math.round(btnRect.width * 2) / 2,
  };
}

function findActiveButton(track: HTMLElement): HTMLElement | null {
  return track.querySelector<HTMLElement>(
    'button[aria-pressed="true"], button[aria-selected="true"], button.is-active, button.is-selected',
  );
}

/**
 * Animated Apple-style segmented control / toolbar action group.
 *
 * Drives a spring-physics active thumb (`translate3d` + `width`) between
 * selected buttons and a magnetic hover capsule that glides across siblings.
 */
export function SegmentedTrack({
  children,
  className = "",
  variant = "segmented",
  onPointerMove,
  onPointerLeave,
  ...props
}: SegmentedTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [activeState, setActiveState] = useState<{
    box: BoxMetric;
    visible: boolean;
    sliding: boolean;
  }>({
    box: { x: 0, width: 0 },
    visible: false,
    sliding: false,
  });
  const wasActiveRef = useRef(false);

  const [hoverState, setHoverState] = useState<{
    box: BoxMetric;
    visible: boolean;
    sliding: boolean;
  }>({
    box: { x: 0, width: 0 },
    visible: false,
    sliding: false,
  });
  const wasHoverRef = useRef(false);
  const hoveredBtnRef = useRef<HTMLElement | null>(null);

  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (!track || variant !== "segmented") return;
    const activeBtn = findActiveButton(track);
    if (!activeBtn) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        setActiveState((prev) => ({ ...prev, visible: false, sliding: false }));
      }
      return;
    }
    const metric = measureButtonInTrack(track, activeBtn);
    if (!metric) return;
    const sliding = wasActiveRef.current;
    wasActiveRef.current = true;
    setActiveState((prev) => {
      if (
        prev.visible &&
        prev.sliding === sliding &&
        prev.box.x === metric.x &&
        prev.box.width === metric.width
      ) {
        return prev;
      }
      return { box: metric, visible: true, sliding };
    });
  }, [variant]);

  useIsomorphicLayoutEffect(() => {
    setReady(true);
    syncActive();
  }, [syncActive, children]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onResize = () => {
      syncActive();
      if (hoveredBtnRef.current && track.contains(hoveredBtnRef.current)) {
        const metric = measureButtonInTrack(track, hoveredBtnRef.current);
        if (metric) {
          setHoverState((prev) => (prev.visible ? { ...prev, box: metric, sliding: false } : prev));
        }
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(track);
    const mo = new MutationObserver(syncActive);
    mo.observe(track, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "aria-selected", "class"],
      childList: true,
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [syncActive]);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(event);
      const track = trackRef.current;
      if (!track || event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target || !track.contains(target) || (target as HTMLButtonElement).disabled) {
        if (wasHoverRef.current) {
          wasHoverRef.current = false;
          hoveredBtnRef.current = null;
          setHoverState((prev) => ({ ...prev, visible: false, sliding: false }));
        }
        return;
      }
      if (hoveredBtnRef.current === target && wasHoverRef.current) return;
      const metric = measureButtonInTrack(track, target);
      if (!metric) return;
      const sliding = wasHoverRef.current;
      wasHoverRef.current = true;
      hoveredBtnRef.current = target;
      setHoverState({ box: metric, visible: true, sliding });
    },
    [onPointerMove],
  );

  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(event);
      wasHoverRef.current = false;
      hoveredBtnRef.current = null;
      setHoverState((prev) => (prev.visible ? { ...prev, visible: false, sliding: false } : prev));
    },
    [onPointerLeave],
  );

  const rootClass = variant === "segmented" ? "apple-segmented" : "apple-toolbar-actions";

  return (
    <div
      {...props}
      ref={trackRef}
      data-glider-ready={ready ? "true" : undefined}
      className={`${rootClass}${className ? ` ${className}` : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {ready && (
        <span
          aria-hidden="true"
          className={`apple-glider-hover${hoverState.visible ? " is-visible" : ""}${hoverState.sliding ? " is-sliding" : ""}`}
          style={{
            width: `${hoverState.box.width}px`,
            transform: `translate3d(${hoverState.box.x}px, 0, 0)`,
          }}
        />
      )}
      {ready && variant === "segmented" && (
        <span
          aria-hidden="true"
          className={`apple-glider-thumb${activeState.visible ? " is-visible" : ""}${activeState.sliding ? " is-sliding" : ""}`}
          style={{
            width: `${activeState.box.width}px`,
            transform: `translate3d(${activeState.box.x}px, 0, 0)`,
          }}
        />
      )}
      {children}
    </div>
  );
}
