import { useState, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useTheme } from "../../hooks/useTheme";
import { useFocus, groupFocusItems } from "../../hooks/useFocus";
import { useMarkDone, useSaveProspect } from "../../hooks/useProspects";
import { SwipeableRow } from "../../components/SwipeableRow";
import { StatusBadge } from "../../components/StatusBadge";
import { MarkDoneModal } from "../../components/MarkDoneModal";
import { EmptyState } from "../../components/EmptyState";
import type { FocusItem } from "../../services/types";

export default function FocusScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { data: items, isLoading, refetch, isRefetching } = useFocus();
  const markDone = useMarkDone();
  const saveMutation = useSaveProspect();
  const [markDoneTarget, setMarkDoneTarget] = useState<FocusItem | null>(null);

  const sections = groupFocusItems(items ?? []);

  const bump2Days = useCallback(
    (item: FocusItem) => {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      const newDate = d.toISOString().slice(0, 10);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      saveMutation.mutate({
        prospects: [{ ...item, nextFollowUp: newDate }],
      });
    },
    [saveMutation]
  );

  const renderItem = useCallback(
    ({ item }: { item: FocusItem }) => (
      <SwipeableRow
        leftLabel={"\u2705 Fait"}
        leftColor={colors.success}
        rightLabel={"+2j"}
        rightColor={colors.warning}
        onSwipeLeft={() => setMarkDoneTarget(item)}
        onSwipeRight={() => bump2Days(item)}
      >
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push(`/prospect/${item.id}`)}
          activeOpacity={0.7}
        >
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
                {[item.company_groupe, item.fonction].filter(Boolean).join(" \u2022 ")}
              </Text>
            </View>
            <StatusBadge status={item.statut} small />
          </View>
          <View style={styles.cardBottom}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {item.nextFollowUp}
            </Text>
            {item.nextAction && (
              <Text style={{ color: colors.accent, fontSize: 12 }} numberOfLines={1}>
                {"\u27a4"} {item.nextAction}
              </Text>
            )}
          </View>
          {/* Quick action buttons */}
          <View style={styles.quickActions}>
            {item.telephone && (
              <TouchableOpacity
                style={[styles.quickBtn, { backgroundColor: colors.success + "20" }]}
                onPress={(e) => {
                  e.stopPropagation();
                  Linking.openURL(`tel:${item.telephone}`);
                }}
              >
                <Text style={{ color: colors.success, fontSize: 12 }}>
                  {"\ud83d\udcde"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.quickBtn, { backgroundColor: colors.warning + "20" }]}
              onPress={(e) => {
                e.stopPropagation();
                setMarkDoneTarget(item);
              }}
            >
              <Text style={{ color: colors.warning, fontSize: 12 }}>
                {"\u2705"} Fait
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </SwipeableRow>
    ),
    [colors, router, bump2Days]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: section.color }]}>
                {section.emoji} {section.title} ({section.data.length})
              </Text>
            </View>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            isLoading ? null : (
              <EmptyState
                emoji={"\ud83c\udf89"}
                title="Aucune relance"
                subtitle="Toutes vos relances sont a jour"
              />
            )
          }
          stickySectionHeadersEnabled={false}
        />
      </View>

      {markDoneTarget && (
        <MarkDoneModal
          visible
          prospectId={markDoneTarget.id}
          prospectName={markDoneTarget.name}
          onClose={() => setMarkDoneTarget(null)}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16 },
  sectionHeader: { marginTop: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: { fontSize: 15, fontWeight: "700" },
  cardBottom: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
    alignItems: "center",
  },
  quickActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  quickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
