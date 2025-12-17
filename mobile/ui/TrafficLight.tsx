import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, radius, shadow, space } from "./theme";

export type TLStatus = "red" | "orange" | "green";

export default function TrafficLight({
  value,
  onChange,
  disabled,
}: {
  value: TLStatus;
  onChange: (v: TLStatus) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.shell, disabled ? { opacity: 0.6 } : null]}>
      <Light
        tone="red"
        active={value === "red"}
        disabled={disabled}
        onPress={() => onChange("red")}
      />
      <Light
        tone="orange"
        active={value === "orange"}
        disabled={disabled}
        onPress={() => onChange("orange")}
      />
      <Light
        tone="green"
        active={value === "green"}
        disabled={disabled}
        onPress={() => onChange("green")}
      />
    </View>
  );
}

function Light({
  tone,
  active,
  onPress,
  disabled,
}: {
  tone: TLStatus;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const bg =
    tone === "red" ? colors.red : tone === "orange" ? colors.orange : colors.green;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Set status ${tone}`}
      style={({ pressed }) => [
        styles.lightWrap,
        pressed && !disabled ? { transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      <View style={styles.bezel}>
        <View
          style={[
            styles.light,
            { backgroundColor: bg },
            active ? styles.active : styles.inactive,
          ]}
        >
          {/* subtle highlight */}
          <View style={styles.glare} />
        </View>
      </View>
    </Pressable>
  );
}

const LIGHT = 38;

const styles = StyleSheet.create({
  shell: {
    alignSelf: "flex-start",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: "#111827", // classic dark housing
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    ...shadow,
  },
  lightWrap: {
    borderRadius: 999,
  },
  bezel: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  light: {
    width: LIGHT,
    height: LIGHT,
    borderRadius: 999,
    overflow: "hidden",
  },
  active: {
    borderWidth: 3,
    borderColor: "#FFFFFF",
    opacity: 1,
  },
  inactive: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.22)",
    opacity: 0.72,
  },
  glare: {
    position: "absolute",
    top: 6,
    left: 7,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
});
