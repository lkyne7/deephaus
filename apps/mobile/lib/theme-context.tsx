import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import {
  createShadows,
  darkColors,
  lightColors,
  type ThemeColors,
  type ThemePreference,
  type ThemeShadows,
} from "@/lib/theme";

const STORAGE_KEY = "@deephaus/theme-preference";

type ThemeContextValue = {
  colors: ThemeColors;
  shadows: ThemeShadows;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  colorScheme: "light" | "dark";
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: "light" | "dark" | null | undefined,
): "light" | "dark" {
  if (preference === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const colorScheme = resolveColorScheme(preference, systemScheme);
  const colors = colorScheme === "dark" ? darkColors : lightColors;
  const shadows = useMemo(() => createShadows(colorScheme), [colorScheme]);

  const value = useMemo(
    () => ({
      colors,
      shadows,
      preference,
      setPreference,
      colorScheme,
    }),
    [colors, shadows, preference, setPreference, colorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
