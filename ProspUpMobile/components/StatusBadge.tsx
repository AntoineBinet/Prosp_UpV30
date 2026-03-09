import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { getStatusColor, getStatusEmoji } from "../constants/statuses";

interface Props {
  status: string | null | undefined;
  small?: boolean;
  onPress?: () => void;
}

export function StatusBadge({ status, small, onPress }: Props) {
  const color = getStatusColor(status);
  const emoji = getStatusEmoji(status);
  const label = status || "N/A";

  const content = (
    <Text
      style={[
        styles.badge,
        {
          backgroundColor: color + "20",
          color,
          fontSize: small ? 11 : 12,
          paddingHorizontal: small ? 6 : 8,
          paddingVertical: small ? 2 : 4,
        },
      ]}
    >
      {emoji} {label}
    </Text>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    fontWeight: "600",
    overflow: "hidden",
    alignSelf: "flex-start",
  },
});
