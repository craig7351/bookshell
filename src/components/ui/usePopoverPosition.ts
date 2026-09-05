import { createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js";

/**
 * Viewport placement for a `position: fixed` popover — clamp, then flip.
 *
 * Every floating surface in the app is fixed-positioned from a measured point
 * (a cursor, a button rect), which means it is the caller's job to keep it on
 * screen. This is that job, once: a context menu opened near the bottom-right
 * corner flips up and to the left of the cursor, a submenu that would run off
 * the right edge opens on the other side of its parent row, and anything
 * taller than the window is pinned inside the margin instead of clipped.
 *
 * The popover renders `visibility: hidden` until it has been measured, so the
 * corrected position is the first one the user ever sees.
 */

export interface PopoverPlacement {
  /** Preferred left edge, in viewport pixels. */
  x: number;
  /** Preferred top edge, in viewport pixels. */
  y: number;
  /**
   * When the popover overflows the right edge, put its RIGHT edge here instead
   * of merely shoving it inwards — a cursor x, or a row's left edge for a
   * submenu. Omitted: clamp inside the margin.
   */
  flipRightTo?: number;
  /** Same idea for the bottom edge: place the popover's BOTTOM edge here. */
  flipBottomTo?: number;
}

/** Breathing room kept between a popover and the window edge. */
const MARGIN = 8;

export function usePopoverPosition(placement: Accessor<PopoverPlacement>) {
  const [pos, setPos] = createSignal({ x: placement().x, y: placement().y });
  const [placed, setPlaced] = createSignal(false);
  let el: HTMLElement | undefined;

  function measure() {
    if (!el || !el.isConnected) return;
    const p = placement();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = p.x;
    if (x + w > vw - MARGIN) {
      x = p.flipRightTo !== undefined ? p.flipRightTo - w : vw - MARGIN - w;
    }
    if (x < MARGIN) x = MARGIN;

    let y = p.y;
    if (y + h > vh - MARGIN) {
      y = p.flipBottomTo !== undefined ? p.flipBottomTo - h : vh - MARGIN - h;
    }
    if (y < MARGIN) y = MARGIN;

    setPos({ x, y });
    setPlaced(true);
  }

  /** Ref callback for the popover element. Measures as soon as it is live. */
  function ref(node: HTMLElement) {
    el = node;
    // The node is usually already in the document (a menu opens into a mounted
    // tree), so this lands before the first paint; the rAF is the backstop for
    // the case where it is not.
    measure();
    requestAnimationFrame(measure);
  }

  // Re-place when the anchor moves (a submenu hopping between rows).
  createEffect(() => {
    placement();
    requestAnimationFrame(measure);
  });

  onMount(() => window.addEventListener("resize", measure));
  onCleanup(() => window.removeEventListener("resize", measure));

  /** Spread into the popover's inline style object. */
  const style = () => ({
    position: "fixed" as const,
    left: `${pos().x}px`,
    top: `${pos().y}px`,
    visibility: placed() ? ("visible" as const) : ("hidden" as const),
  });

  return { ref, pos, style };
}
