import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../hooks/useTheme";

interface Props {
  emoji: string;
  title: string;
  subtitle?: string;
}

export function EmptyState({ emoji, title, subtitle }: Props) {
  const colors = useTheme();
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: 60 },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
});
