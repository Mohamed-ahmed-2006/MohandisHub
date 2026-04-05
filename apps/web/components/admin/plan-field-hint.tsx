'use client';

import { Info } from 'lucide-react';

type Props = { text: string };

/** Native `title` tooltip for plan field help (hover or long-press on touch). */
export function PlanFieldHint({ text }: Props) {
  return (
    <button
      type="button"
      className="admin-plan-field-hint"
      title={text}
      aria-label={text}
    >
      <Info size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}
