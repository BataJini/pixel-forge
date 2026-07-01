/** Theme system barrel — tokens source, contrast math, CRT model, provider. */
export {
  contrastRatio,
  meetsAA,
  meetsAALarge,
  meetsNonTextContrast,
  parseHex,
  type Rgb,
  relativeLuminance,
} from './contrast';
export {
  CRT_LEVELS,
  type CrtLevel,
  DEFAULT_CRT_LEVEL,
  effectiveCrtLevel,
  isCrtLevel,
} from './crt';
export {
  ThemeContext,
  type ThemeContextValue,
  ThemeProvider,
  type ThemeProviderProps,
} from './ThemeProvider';
export {
  CSS_VAR,
  DEFAULT_THEME,
  isThemeId,
  THEME_IDS,
  THEMES,
  type ThemeId,
  type ThemeMeta,
  type ThemeTokens,
  TOKEN_KEYS,
  type TokenKey,
} from './themes';
export { useTheme } from './useTheme';
