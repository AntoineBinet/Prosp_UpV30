import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../hooks/useTheme";

interface Props {
  label: string;
  value: number;
  trend?: number;
}

export function KPICard({ label, value, trend }: Props) {
  const colors = useTheme();
  const trendColor =
    trend === undefined || trend === 0
      ? colors.textSecondary
      : trend > 0
        ? colors.success
        : colors.error;
  const trendIcon =
    trend === undefined || trend === 0
      ? ""
      : trend > 0
        ? "\u2191"
        : "\u2193";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      {trend !== undefined && trend !== 0 && (
        <Text style={[styles.trend, { color: trendColor }]}>
          {trendIcon} {Math.abs(trend)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 110,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  value: { fontSize: 28, fontWeight: "800" },
  label: { fontSize: 12, marginTop: 4 },
  trend: { fontSize: 11, fontWeight: "600", marginTop: 4 },
});
