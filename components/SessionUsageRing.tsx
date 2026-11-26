"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { formatActiveDuration, formatCompactCount } from "@/lib/session-stats-format";
import { focusIfLost } from "@/lib/stacked-dialog";

export interface SessionUsageContextInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface SessionUsageProjectMeta {
  projectDir?: string | null;
  gitBranch?: string | null;
  gitWorktree?: string | null;
}

export type UsageRingCategory = "input" | "cacheRead" | "cacheWrite" | "output";

export interface UsageRingSegment {
  key: UsageRingCategory;
  color: string;
  value: number;
  share: number;
  visualWeight: number;
  dashArray: string;
  dashOffset: number;
}

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";

const RING_RADIUS = 7.5;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const RING_COLORS: Record<UsageRingCategory, string> = {
  input: "var(--ring-input, #4f46e5)",
  cacheRead: "var(--ring-cache-read, #10b981)",
  cacheWrite: "var(--ring-cache-write, #0ea5e9)",
  output: "var(--ring-output, #f59e0b)",
};

/**
 * Computes multi-color ring segments with dampened perceptual weighting
 * so small categories (e.g. Output 28k vs Cache Read 5.7M) remain clearly
 * visible on the circular ring while preserving relative rank order.
 */
export function computeUsageRingSegments(
  tokens: SessionStatsInfo["tokens"] | null | undefined,
  circumference: number = RING_CIRCUMFERENCE,
): { segments: UsageRingSegment[]; isIdle: boolean } {
  const entries: Array<{ key: UsageRingCategory; value: number }> = [
    { key: "input", value: Math.max(0, tokens?.input ?? 0) },
    { key: "cacheRead", value: Math.max(0, tokens?.cacheRead ?? 0) },
    { key: "cacheWrite", value: Math.max(0, tokens?.cacheWrite ?? 0) },
    { key: "output", value: Math.max(0, tokens?.output ?? 0) },
  ];

  const active = entries.filter((entry) => entry.value > 0);
  if (active.length === 0) {
    const idleKeys: UsageRingCategory[] = ["input", "cacheRead", "output"];
    const gap = 4.2;
    const avail = Math.max(9, circumference - gap * idleKeys.length);
    const segLen = avail / idleKeys.length;
    let cursor = 0;
    const segments: UsageRingSegment[] = idleKeys.map((key) => {
      const seg: UsageRingSegment = {
        key,
        color: RING_COLORS[key],
        value: 0,
        share: 1 / idleKeys.length,
        visualWeight: 1 / idleKeys.length,
        dashArray: `${segLen.toFixed(2)} ${circumference.toFixed(2)}`,
        dashOffset: Number((-cursor).toFixed(2)),
      };
      cursor += segLen + gap;
      return seg;
    });
    return { segments, isIdle: true };
  }

  const rawSum = active.reduce((acc, item) => acc + item.value, 0);
  const weighted = active.map((item) => {
    const share = item.value / rawSum;
    return {
      ...item,
      share,
      weight: Math.pow(share, 0.36),
    };
  });
  const weightSum = weighted.reduce((acc, item) => acc + item.weight, 0);
  const gap = active.length > 1 ? 3.5 : 0;
  const avail = Math.max(8, circumference - gap * active.length);

  let cursor = 0;
  const segments: UsageRingSegment[] = weighted.map((item) => {
    const visualWeight = item.weight / weightSum;
    const segLen = Math.max(1.6, avail * visualWeight);
    const seg: UsageRingSegment = {
      key: item.key,
      color: RING_COLORS[item.key],
      value: item.value,
      share: item.share,
      visualWeight,
      dashArray: `${segLen.toFixed(2)} ${circumference.toFixed(2)}`,
      dashOffset: Number((-cursor).toFixed(2)),
    };
    cursor += segLen + gap;
    return seg;
  });

  return { segments, isIdle: false };
}

function compactMiddlePath(text: string, maxChars = 36): string {
  if (text.length <= maxChars) return text;
  const keepStart = Math.max(10, Math.floor((maxChars - 1) * 0.42));
  const keepEnd = Math.max(12, maxChars - 1 - keepStart);
  return `${text.slice(0, keepStart)}…${text.slice(text.length - keepEnd)}`;
}

interface SessionUsageRingProps {
  sessionStats?: SessionStatsInfo | null;
  contextUsage?: SessionUsageContextInfo | null;
  projectMeta?: SessionUsageProjectMeta | null;
  controlSize: number;
  isMobile?: boolean;
  openTriggerRef?: React.MutableRefObject<(() => void) | null>;
}

export function SessionUsageRing({
  sessionStats,
  contextUsage,
  projectMeta,
  controlSize,
  isMobile = false,
  openTriggerRef,
}: SessionUsageRingProps) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copiedField, setCopiedField] = useState<SessionCopyField | null>(null);
  const [popoverWidth, setPopoverWidth] = useState<number>(368);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = hovered || pinned;

  const clearHoverTimer = useCallback(() => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const closeAll = useCallback((restoreFocus = false) => {
    clearHoverTimer();
    setHovered(false);
    setPinned(false);
    if (restoreFocus) {
      requestAnimationFrame(() => focusIfLost(document, buttonRef.current));
    }
  }, [clearHoverTimer]);

  useEffect(() => {
    if (!openTriggerRef) return;
    openTriggerRef.current = () => {
      clearHoverTimer();
      setPinned(true);
    };
    return () => {
      openTriggerRef.current = null;
    };
  }, [openTriggerRef, clearHoverTimer]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const host = wrapperRef.current?.closest(".chat-content") as HTMLElement | null;
      const avail = host ? host.getBoundingClientRect().width : window.innerWidth;
      setPopoverWidth(Math.max(248, Math.min(376, Math.round(avail - 20))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closeAll(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeAll(true);
      }
    };
    const checkInert = () => {
      if (wrapperRef.current?.closest("[inert]")) {
        closeAll(false);
      }
    };

    checkInert();
    const observer = new MutationObserver(checkInert);
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["inert"] });

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, closeAll]);

  const handlePointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearHoverTimer();
    setHovered(true);
  }, [clearHoverTimer]);

  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearHoverTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setHovered(false);
    }, 150);
  }, [clearHoverTimer]);

  const handleButtonClick = useCallback(() => {
    clearHoverTimer();
    if (pinned) {
      setPinned(false);
      setHovered(false);
    } else {
      setPinned(true);
    }
  }, [pinned, clearHoverTimer]);

  const handleCopy = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedField(field);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 1400);
    }, () => {});
  }, []);

  const ctx = contextUsage ?? sessionStats?.contextUsage ?? null;
  const contextPercent = ctx?.percent ?? null;
  const { segments, isIdle } = computeUsageRingSegments(sessionStats?.tokens);

  const clampedContextPercent = contextPercent !== null
    ? Math.max(0, Math.min(100, contextPercent))
    : null;

  let contextRingColor = "var(--accent)";
  let contextTextColor = "var(--text-muted)";
  if (clampedContextPercent !== null && clampedContextPercent > 90) {
    contextRingColor = "#ef4444";
    contextTextColor = "#ef4444";
  } else if (clampedContextPercent !== null && clampedContextPercent > 70) {
    contextRingColor = "#f59e0b";
    contextTextColor = "#d97706";
  }

  const ringSize = isMobile ? 20 : 17;
  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const totalActiveMs = sessionStats?.totalActiveMs ?? 0;

  const cacheDenom = tokens ? tokens.cacheRead + tokens.cacheWrite + tokens.input : 0;
  const cacheHitRate = tokens && (tokens.cacheRead + tokens.cacheWrite > 0) && cacheDenom > 0
    ? `${((tokens.cacheRead / cacheDenom) * 100).toFixed(1)}%`
    : null;

  const copyTitleKey: Record<SessionCopyField, Parameters<typeof t>[0]> = {
    file: "session.copyFile",
    id: "session.copyId",
    projectDir: "session.copyProjectDir",
    gitBranch: "session.copyGitBranch",
    gitWorktree: "session.copyGitWorktree",
  };

  const metadataRows: Array<{ label: string; value: string; copyField: SessionCopyField | null }> = [
    ...(sessionStats?.sessionName ? [{ label: t("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
    ...(sessionStats ? [
      { label: t("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
      { label: t("session.file"), value: sessionStats.sessionFile ?? t("session.inMemory"), copyField: sessionStats.sessionFile ? ("file" as const) : null },
    ] : []),
    ...(projectMeta?.projectDir ? [{ label: t("session.projectDir"), value: projectMeta.projectDir, copyField: "projectDir" as const }] : []),
    ...(projectMeta?.gitBranch ? [{ label: t("session.gitBranch"), value: projectMeta.gitBranch, copyField: "gitBranch" as const }] : []),
    ...(projectMeta?.gitWorktree ? [{ label: t("session.gitWorktree"), value: projectMeta.gitWorktree, copyField: "gitWorktree" as const }] : []),
  ];

  const renderRingSvg = (size: number) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        stroke="color-mix(in oklab, var(--text) 10%, transparent)"
        strokeWidth="2.5"
      />
      <g transform="rotate(-90 10 10)" style={{ opacity: isIdle ? 0.52 : 1 }}>
        {segments.map((seg) => (
          <circle
            key={seg.key}
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke={seg.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={seg.dashArray}
            strokeDashoffset={seg.dashOffset}
            style={{
              transition: "stroke-dasharray 320ms cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        ))}
      </g>
    </svg>
  );

  const renderContextRingSvg = (size: number) => {
    const filledLen = clampedContextPercent !== null
      ? (clampedContextPercent > 0 ? Math.max(1.8, (clampedContextPercent / 100) * RING_CIRCUMFERENCE) : 0)
      : 0;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        style={{ display: "block", flexShrink: 0 }}
      >
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          stroke="color-mix(in oklab, var(--text) 16%, transparent)"
          strokeWidth="2.5"
        />
        {clampedContextPercent !== null && clampedContextPercent > 0 && (
          <g transform="rotate(-90 10 10)">
            <circle
              cx="10"
              cy="10"
              r={RING_RADIUS}
              fill="none"
              stroke={contextRingColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${filledLen.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
              style={{
                transition: "stroke-dasharray 360ms var(--ease-out-quint, cubic-bezier(0.23, 1, 0.32, 1)), stroke 220ms ease",
              }}
            />
          </g>
        )}
      </svg>
    );
  };

  return (
    <div
      ref={wrapperRef}
      className="session-usage-ring-anchor"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleButtonClick}
        aria-label={t("session.title")}
        aria-expanded={isOpen}
        aria-pressed={pinned}
        aria-haspopup="dialog"
        className="session-usage-ring-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          minWidth: controlSize,
          height: controlSize,
          padding: !isMobile && clampedContextPercent !== null ? "0 8px 0 6px" : 0,
          border: "none",
          borderRadius: 9,
          background: isOpen
            ? "color-mix(in oklab, var(--accent) 9%, var(--bg-hover))"
            : "transparent",
          cursor: "pointer",
          transition: "background-color 140ms ease, transform 140ms var(--ease-out-quint, cubic-bezier(0.23, 1, 0.32, 1))",
        }}
      >
        {renderContextRingSvg(ringSize)}
        {!isMobile && clampedContextPercent !== null && (
          <span
            className="session-usage-ring-pct"
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: contextTextColor,
              whiteSpace: "nowrap",
              transition: "color 220ms ease",
            }}
          >
            {Math.round(clampedContextPercent)}%
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Hover bridge across the 10px gap between trigger button and popover */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 0,
              bottom: "100%",
              width: popoverWidth,
              height: 12,
              zIndex: 179,
            }}
          />
          <div
          role="dialog"
          aria-label={t("session.title")}
          className="session-info-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            right: 0,
            width: popoverWidth,
            maxHeight: "min(500px, calc(100dvh - 120px))",
            overflowY: "auto",
            zIndex: 180,
            padding: "14px 15px",
            borderRadius: 16,
            border: "1px solid var(--glass-rim)",
            background: "color-mix(in oklab, var(--bg) 93%, var(--bg-panel))",
            backdropFilter: "blur(24px) saturate(190%)",
            WebkitBackdropFilter: "blur(24px) saturate(190%)",
            boxShadow:
              "0 18px 42px -10px rgba(15, 23, 42, 0.20), 0 4px 12px -3px rgba(15, 23, 42, 0.08), 0 0 0 0.5px rgba(15, 23, 42, 0.06)",
            color: "var(--text)",
            fontSize: 13,
            lineHeight: 1.5,
            fontVariantNumeric: "tabular-nums",
            transformOrigin: "bottom right",
          }}
        >

          {/* Header row: Ring + Session Info + Active time + Cost pill */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              {renderRingSvg(15)}
              <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)", whiteSpace: "nowrap" }}>
                {t("session.title")}
              </span>
              {totalActiveMs > 0 && (
                <span style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                  · {formatActiveDuration(totalActiveMs)}
                </span>
              )}
            </div>
            {cost > 0 && (
              <span
                title={`${t("session.cost")}: $${cost.toFixed(4)}`}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--bg-subtle)",
                  border: "1px solid color-mix(in oklab, var(--accent) 18%, transparent)",
                  color: "var(--accent)",
                  fontWeight: 600,
                  fontSize: 12.5,
                  whiteSpace: "nowrap",
                }}
              >
                ${cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)}
              </span>
            )}
          </div>

          {/* Context window bar */}
          {ctx?.contextWindow ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5, fontSize: 12.5 }}>
                <span style={{ color: "var(--text-muted)" }}>{t("session.context")}</span>
                <span style={{
                  fontWeight: 500,
                  color: contextPercent !== null && contextPercent > 90
                    ? "#ef4444"
                    : contextPercent !== null && contextPercent > 70
                      ? "#d97706"
                      : "var(--text)",
                }}>
                  {contextPercent !== null ? `${contextPercent.toFixed(1)}%` : "?"}
                  <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
                    {ctx.tokens !== null && ctx.tokens !== undefined
                      ? ` · ${formatCompactCount(ctx.tokens)} / ${formatCompactCount(ctx.contextWindow)}`
                      : ` / ${formatCompactCount(ctx.contextWindow)}`}
                  </span>
                </span>
              </div>
              <div style={{
                height: 6,
                borderRadius: 999,
                background: "color-mix(in oklab, var(--text) 8%, transparent)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(contextPercent ? 2 : 0, contextPercent ?? 0))}%`,
                  borderRadius: 999,
                  background: contextPercent !== null && contextPercent > 90
                    ? "#ef4444"
                    : contextPercent !== null && contextPercent > 70
                      ? "#f59e0b"
                      : "var(--accent)",
                  transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                }} />
              </div>
            </div>
          ) : null}

          {sessionStats && tokens ? (
            <>
              {/* Multi-color token composition bar + color-coded breakdown */}
              <div style={{
                padding: "10px 11px",
                borderRadius: 11,
                background: "color-mix(in oklab, var(--text) 3.2%, transparent)",
                border: "1px solid color-mix(in oklab, var(--border) 65%, transparent)",
                marginBottom: 10,
              }}>
                {!isIdle && (
                  <div style={{
                    display: "flex",
                    height: 5,
                    borderRadius: 999,
                    overflow: "hidden",
                    gap: 2,
                    marginBottom: 9,
                  }}>
                    {segments.map((seg) => (
                      <div
                        key={seg.key}
                        style={{
                          flex: seg.visualWeight,
                          background: seg.color,
                          borderRadius: 999,
                          minWidth: 6,
                        }}
                      />
                    ))}
                  </div>
                )}

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "6px 14px",
                  fontSize: 12.5,
                }}>
                  {([
                    { key: "input" as const, label: t("session.input"), val: tokens.input },
                    { key: "output" as const, label: t("session.output"), val: tokens.output },
                    ...(tokens.cacheRead > 0 ? [{ key: "cacheRead" as const, label: t("session.cacheRead"), val: tokens.cacheRead }] : []),
                    ...(tokens.cacheWrite > 0 ? [{ key: "cacheWrite" as const, label: t("session.cacheWrite"), val: tokens.cacheWrite }] : []),
                  ]).map((item) => (
                    <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, minWidth: 0 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", minWidth: 0, overflow: "hidden" }}>
                        <span style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: RING_COLORS[item.key],
                          flexShrink: 0,
                        }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                      </span>
                      <span style={{ color: "var(--text)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {formatCompactCount(item.val)}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginTop: 8,
                  paddingTop: 7,
                  borderTop: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
                  fontSize: 12,
                }}>
                  <span style={{ color: "var(--text-dim)" }}>
                    {t("session.total")}: <strong style={{ color: "var(--text)", fontWeight: 600 }}>{tokens.total.toLocaleString(locale)}</strong>
                  </span>
                  {cacheHitRate && (
                    <span style={{ color: "var(--ring-cache-read, #10b981)", fontWeight: 500 }}>
                      {t("session.cacheHitRate")} {cacheHitRate}
                    </span>
                  )}
                </div>
              </div>

              {/* Compact 4-column message counts */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 6,
                marginBottom: metadataRows.length > 0 ? 10 : 0,
              }}>
                {[
                  [t("session.user"), sessionStats.userMessages],
                  [t("session.assistant"), sessionStats.assistantMessages],
                  [t("session.toolCalls"), sessionStats.toolCalls],
                  [t("session.total"), sessionStats.totalMessages],
                ].map(([label, count]) => (
                  <div
                    key={String(label)}
                    style={{
                      padding: "5px 6px",
                      borderRadius: 8,
                      background: "color-mix(in oklab, var(--text) 2.8%, transparent)",
                      textAlign: "center",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      {Number(count).toLocaleString(locale)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{
              padding: "8px 10px",
              borderRadius: 9,
              background: "color-mix(in oklab, var(--text) 3%, transparent)",
              color: "var(--text-muted)",
              fontSize: 12.5,
              marginBottom: metadataRows.length > 0 ? 10 : 0,
            }}>
              {t("session.load")}
            </div>
          )}

          {/* Session & Workspace Metadata with 1-click Copy */}
          {metadataRows.length > 0 && (
            <div style={{
              paddingTop: 9,
              borderTop: "1px solid color-mix(in oklab, var(--border) 68%, transparent)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
              fontSize: 12,
            }}>
              {metadataRows.map((row) => {
                const copied = row.copyField !== null && copiedField === row.copyField;
                return (
                  <div
                    key={`${row.label}:${row.copyField ?? "plain"}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto minmax(0, 1fr) auto",
                      alignItems: "center",
                      columnGap: 8,
                    }}
                  >
                    <span style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</span>
                    <span
                      title={row.value}
                      style={{
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textAlign: "right",
                      }}
                    >
                      {compactMiddlePath(row.value, 34)}
                    </span>
                    {row.copyField ? (
                      <button
                        type="button"
                        title={copied ? t("session.copied") : t(copyTitleKey[row.copyField])}
                        aria-label={copied ? t("session.copied") : t(copyTitleKey[row.copyField])}
                        onClick={() => handleCopy(row.copyField!, row.value)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          padding: 0,
                          borderRadius: 5,
                          border: `1px solid ${copied ? "var(--accent)" : "var(--border)"}`,
                          background: "transparent",
                          color: copied ? "var(--accent)" : "var(--text-dim)",
                          cursor: "pointer",
                          transition: "color 120ms, border-color 120ms, background 120ms",
                        }}
                      >
                        {copied ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    ) : (
                      <span style={{ width: 20 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
