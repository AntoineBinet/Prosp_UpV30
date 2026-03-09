import { useColorScheme } from "react-native";
import { Colors, type ThemeColors } from "../constants/colors";

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === "light" ? Colors.light : Colors.dark;
}
