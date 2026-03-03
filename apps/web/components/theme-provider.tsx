'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppTheme = 'light' | 'dark';

type ThemeContextValue = {
  theme: AppTheme;
  resolvedTheme: AppTheme;
  setTheme: (nextTheme: AppTheme) => void;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = 'mohandishub-theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getSystemTheme = (): AppTheme => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (nextTheme: AppTheme): void => {
  document.documentElement.dataset.theme = nextTheme;
};

type ThemeProviderProps = {
  children: React.ReactNode;
};

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setThemeState] = useState<AppTheme>('light');

  useEffect(() => {
    const persistedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: AppTheme =
      persistedTheme === 'light' || persistedTheme === 'dark' ? persistedTheme : getSystemTheme();

    setThemeState(initialTheme);
    applyTheme(initialTheme);
  }, []);

  const setTheme = (nextTheme: AppTheme): void => {
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  const toggleTheme = (): void => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
      toggleTheme,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
};

export const themeInitScript = `
(function(){
  var key='mohandishub-theme';
  var persisted=localStorage.getItem(key);
  var systemDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme=(persisted==='light'||persisted==='dark') ? persisted : (systemDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
`;
