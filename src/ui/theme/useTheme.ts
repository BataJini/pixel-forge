import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider';

/**
 * Access the theme + display settings. Throws when used outside a ThemeProvider
 * — a programmer error, not an expected runtime failure.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used within a <ThemeProvider>.');
  }
  return value;
}
