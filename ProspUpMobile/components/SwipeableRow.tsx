import { useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useTheme } from "../hooks/useTheme";

interface Props {
  children: React.ReactNode;
  leftLabel?: string;
  leftColor?: string;
  rightLabel?: string;
  rightColor?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function SwipeableRow({
  children,
  leftLabel = "\ud83d\udcde Appeler",
  leftColor,
  rightLabel = "\ud83d\udd04 Statut",
  rightColor,
  onSwipeLeft,
  onSwipeRight,
}: Props) {
  const colors = useTheme();
  const swipeRef = useRef<Swipeable>(null);

  const renderLeftActions = () => {
    if (!onSwipeLeft) return null;
    return (
      <View style={[styles.action, { backgroundColor: leftColor ?? colors.success }]}>
        <Text style={styles.actionText}>{leftLabel}</Text>
      </View>
    );
  };

  const renderRightActions = () => {
    if (!onSwipeRight) return null;
    return (
      <View style={[styles.action, styles.rightAction, { backgroundColor: rightColor ?? colors.accent }]}>
        <Text style={styles.actionText}>{rightLabel}</Text>
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={onSwipeLeft ? renderLeftActions : undefined}
      renderRightActions={onSwipeRight ? renderRightActions : undefined}
      onSwipeableOpen={(direction) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (direction === "left") onSwipeLeft?.();
        else onSwipeRight?.();
        setTimeout(() => swipeRef.current?.close(), 300);
      }}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: "center",
    alignItems: "center",
    width: 90,
    borderRadius: 10,
    marginBottom: 8,
  },
  rightAction: {
    alignItems: "center",
  },
  actionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});
