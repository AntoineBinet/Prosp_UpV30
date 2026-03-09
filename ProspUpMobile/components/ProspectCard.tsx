import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../hooks/useTheme";
import { StatusBadge } from "./StatusBadge";
import { PertinenceStars } from "./PertinenceStars";
import type { Prospect, Company } from "../services/types";

interface Props {
  prospect: Prospect;
  companyName?: string;
  onPress?: () => void;
}

export function ProspectCard({ prospect, companyName, onPress }: Props) {
  const colors = useTheme();
  const router = useRouter();

  const isOverdue =
    prospect.nextFollowUp &&
    prospect.nextFollowUp < new Date().toISOString().slice(0, 10);
  const isToday =
    prospect.nextFollowUp === new Date().toISOString().slice(0, 10);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress ?? (() => router.push(`/prospect/${prospect.id}`))}
      activeOpacity={0.7}
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {prospect.name}
          </Text>
          {(companyName || prospect.fonction) && (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {[companyName, prospect.fonction].filter(Boolean).join(" \u2022 ")}
            </Text>
          )}
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 18 }}>{"\u203a"}</Text>
      </View>

      <View style={styles.bottomRow}>
        <StatusBadge status={prospect.statut} small />
        <PertinenceStars value={prospect.pertinence} />
        {prospect.nextFollowUp && (
          <Text
            style={[
              styles.followUp,
              {
                color: isOverdue
                  ? colors.error
                  : isToday
                    ? colors.warning
                    : colors.textSecondary,
              },
            ]}
          >
            {prospect.nextFollowUp}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  name: { fontSize: 15, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  followUp: { fontSize: 11, fontWeight: "500" },
});
