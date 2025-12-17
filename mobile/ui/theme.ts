import { Platform } from "react-native";

export const colors = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  text: "#101828",
  muted: "#667085",
  border: "#EAECF0",

  primary: "#16A34A",      // green
  primaryText: "#FFFFFF",

  red: "#DC2626",
  orange: "#F59E0B",
  green: "#16A34A",
};

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 2 },
  default: {},
});
