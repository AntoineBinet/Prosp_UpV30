import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface Props {
  value: string | number | null | undefined;
  editable?: boolean;
  onChange?: (v: number) => void;
}

export function PertinenceStars({ value, editable, onChange }: Props) {
  const num = typeof value === "string" ? parseInt(value, 10) || 0 : value ?? 0;

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= num;
        const el = (
          <Text key={star} style={[styles.star, { opacity: filled ? 1 : 0.3 }]}>
            {"\u2605"}
          </Text>
        );
        if (editable && onChange) {
          return (
            <TouchableOpacity key={star} onPress={() => onChange(star)}>
              {el}
            </TouchableOpacity>
          );
        }
        return el;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 2 },
  star: { fontSize: 14, color: "#f59e0b" },
});
