import type { Trace, TraceEvent } from './types.ts';
import { freezeTrace, validateTrace } from './trace.ts';
export class Playback {
  readonly trace: Trace;
  index = 0;
  speed = 1;
  playing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<
    (event: TraceEvent | null, index: number) => void
  >();
  constructor(trace: Trace) {
    this.trace = freezeTrace(validateTrace(trace));
  }
  get state(): TraceEvent | null {
    return this.trace.events[this.index] ?? null;
  }
  subscribe(fn: (event: TraceEvent | null, index: number) => void): () => void {
    this.listeners.add(fn);
    fn(this.state, this.index);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(): void {
    for (const fn of this.listeners) fn(this.state, this.index);
  }
  seek(index: number): void {
    if (!Number.isFinite(index)) return;
    this.index = Math.max(
      0,
      Math.min(this.trace.events.length - 1, Math.trunc(index)),
    );
    if (this.index === this.trace.events.length - 1) this.pause();
    this.emit();
  }
  next(): void {
    this.seek(this.index + 1);
  }
  previous(): void {
    this.seek(this.index - 1);
  }
  reset(): void {
    this.pause();
    this.seek(0);
  }
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 16)
      throw new Error('Speed must be between 0.1 and 16');
    this.speed = speed;
    if (this.playing) {
      this.pause();
      this.play();
    }
  }
  play(): void {
    if (this.playing || this.index >= this.trace.events.length - 1) return;
    this.playing = true;
    this.emit();
    this.schedule();
  }
  private schedule(): void {
    this.timer = setTimeout(() => {
      this.next();
      if (this.playing) this.schedule();
    }, 600 / this.speed);
  }
  pause(): void {
    this.playing = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.emit();
  }
}
