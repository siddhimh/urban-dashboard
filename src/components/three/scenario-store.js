// Tiny external store for per-building "what-if" scenarios.
//
// Each record (keyed by id) can have a proposedFloors override. The
// renderer reads this to draw the original as a transparent ghost
// and the proposed mass as a solid form (Scenario Ghosting in the
// PDF). Lifted out of React state so:
//
//   1. Multiple components can subscribe without prop drilling.
//   2. Updates don't force a re-render of the whole scene tree --
//      consumers pull only the keys they need.
//   3. We can later persist to localStorage without surgery.
//
// Implementation is hand-rolled around useSyncExternalStore so we
// don't pick up a new dependency just to track ~tens of overrides.

import { useSyncExternalStore } from "react";

// Map<id, { proposedFloors: number }>
let state = new Map();
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Defensive: a bad listener shouldn't poison the rest.
    }
  });
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

export function setProposedFloors(id, floors) {
  if (id == null) return;
  const next = new Map(state);
  if (floors == null || !Number.isFinite(floors)) {
    next.delete(id);
  } else {
    next.set(id, { proposedFloors: Math.max(1, Math.round(floors)) });
  }
  state = next;
  emit();
}

export function clearProposal(id) {
  if (id == null) return;
  if (!state.has(id)) return;
  const next = new Map(state);
  next.delete(id);
  state = next;
  emit();
}

export function clearAllProposals() {
  if (state.size === 0) return;
  state = new Map();
  emit();
}

export function getProposal(id) {
  return state.get(id) ?? null;
}

export function useScenarioStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Hook variant for a single record. Returns proposedFloors or null,
// re-renders only when this record's entry changes.
export function useProposedFloors(id) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const entry = snap.get(id);
  return entry?.proposedFloors ?? null;
}
