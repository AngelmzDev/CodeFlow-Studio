import type { Trace } from '../src/core/types.ts';

export interface StepGuideChange {
  name: string;
  before: string;
  after: string;
}

export interface StepGuideDescription {
  title: string;
  code: string;
  line: number | null;
  action: string;
  changes: StepGuideChange[];
  comparison: string;
}

export function describeStep(
  trace: Trace,
  index: number,
  locale?: string,
): StepGuideDescription;
