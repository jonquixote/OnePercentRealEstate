// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMetroRotation } from './useMetroRotation';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useMetroRotation', () => {
  it('advances through a shuffled order on the interval', () => {
    const { result } = renderHook(() => useMetroRotation(4, { intervalMs: 6000 }));
    const seen = [result.current.order[result.current.index]];
    act(() => { vi.advanceTimersByTime(6000); });
    seen.push(result.current.order[result.current.index]);
    act(() => { vi.advanceTimersByTime(6000); });
    seen.push(result.current.order[result.current.index]);
    expect(new Set(seen).size).toBe(3);
    expect([...result.current.order].sort()).toEqual([0, 1, 2, 3]);
  });

  it('does not rotate while paused, resumes after', () => {
    const { result } = renderHook(() => useMetroRotation(3));
    const before = result.current.index;
    act(() => { result.current.setPaused(true); });
    act(() => { vi.advanceTimersByTime(20000); });
    expect(result.current.index).toBe(before);
    act(() => { result.current.setPaused(false); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(result.current.index).not.toBe(before);
  });

  it('pin() stops rotation permanently', () => {
    const { result } = renderHook(() => useMetroRotation(3));
    act(() => { result.current.pin(); });
    const at = result.current.index;
    act(() => { vi.advanceTimersByTime(60000); });
    expect(result.current.index).toBe(at);
    expect(result.current.pinned).toBe(true);
  });

  it('never rotates under reduced motion or with a single entry', () => {
    const rm = renderHook(() => useMetroRotation(3, { reduceMotion: true }));
    const single = renderHook(() => useMetroRotation(1));
    act(() => { vi.advanceTimersByTime(30000); });
    expect(rm.result.current.index).toBe(0);
    expect(single.result.current.index).toBe(0);
  });

  it('startIndex leads the tour; remaining entries still all appear', () => {
    const { result } = renderHook(() => useMetroRotation(4, { intervalMs: 6000, startIndex: 2 }));
    expect(result.current.order[result.current.index]).toBe(2);
    const seen = new Set<number>();
    for (let k = 0; k < 4; k++) {
      seen.add(result.current.order[result.current.index]);
      act(() => { vi.advanceTimersByTime(6000); });
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});
