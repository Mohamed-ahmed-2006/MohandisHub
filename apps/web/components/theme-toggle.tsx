'use client';

import { useTheme } from './theme-provider';

type ThemeToggleProps = {
  switchToLightLabel: string;
  switchToDarkLabel: string;
  darkLabel: string;
  lightLabel: string;
};

export const ThemeToggle = ({
  switchToLightLabel,
  switchToDarkLabel,
  darkLabel,
  lightLabel,
}: ThemeToggleProps) => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle-button"
      aria-label={isDark ? switchToLightLabel : switchToDarkLabel}
      aria-pressed={isDark}
      onClick={toggleTheme}
      suppressHydrationWarning
    >
      <span className="theme-toggle-icon-track" aria-hidden="true">
        <span className="theme-toggle-icon-knob" />
      </span>
      <span className="theme-toggle-label">{isDark ? darkLabel : lightLabel}</span>
    </button>
  );
};
