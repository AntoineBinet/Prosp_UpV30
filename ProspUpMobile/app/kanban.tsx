import { useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Dimensions,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useTheme } from "../hooks/useTheme";
import { useProspects, useSaveProspect } from "../hooks/useProspects";
import { STATUSES } from "../constants/statuses";
import type { Prospect, Company } from "../services/types";

const COLUMN_WIDTH = Dimensions.get("window").width * 0.7;

export default function KanbanScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useProspects();
  const saveMutation = useSaveProspect();

  const { columns, companiesMap } = useMemo(() => {
    const cMap = new Map<number, Company>();
    const byStatus: Record<string, Prospect[]> = {};
    for (const s of STATUSES) byStatus[s.key] = [];

    for (const page of data?.pages ?? []) {
      for (const c of page.companies ?? []) cMap.set(c.id, c);
      for (const p of page.prospects ?? []) {
        const key = p.statut || STATUSES[0].key;
        if (byStatus[key]) byStatus[key].push(p);
        else byStatus[STATUSES[0].key].push(p);
      }
    }

    return {
      columns: STATUSES.map((s) => ({
        ...s,
        prospects: byStatus[s.key] || [],
      })),
      companiesMap: cMap,
    };
  }, [data]);

  const moveToStatus = useCallback(
    (prospect: Prospect, newStatus: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      saveMutation.mutate({
        prospects: [{ ...prospect, statut: newStatus }],
      });
    },
    [saveMutation]
  );

  const showMoveMenu = useCallback(
    (prospect: Prospect) => {
      Alert.alert(
        "Deplacer vers...",
        prospect.name,
        STATUSES.filter((s) => s.key !== prospect.statut).map((s) => ({
          text: `${s.emoji} ${s.label}`,
          onPress: () => moveToStatus(prospect, s.key),
        }))
      );
    },
    [moveToStatus]
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Pipeline Kanban" }} />

      <ScrollView
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.boardContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {columns.map((col) => (
          <View
            key={col.key}
            style={[styles.column, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {/* Column header */}
            <View style={[styles.colHeader, { borderBottomColor: col.color }]}>
              <Text style={{ fontSize: 16 }}>{col.emoji}</Text>
              <Text style={[styles.colTitle, { color: colors.text }]} numberOfLines={1}>
                {col.label}
              </Text>
              <View style={[styles.badge, { backgroundColor: col.color + "30" }]}>
                <Text style={[styles.badgeText, { color: col.color }]}>
                  {col.prospects.length}
                </Text>
              </View>
            </View>

            {/* Cards */}
            <FlatList
              data={col.prospects}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => {
                const company = companiesMap.get(item.company_id);
                const isOverdue =
                  item.nextFollowUp && item.nextFollowUp < today;

                return (
                  <TouchableOpacity
                    style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => router.push(`/prospect/${item.id}`)}
                    onLongPress={() => showMoveMenu(item)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[styles.cardName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {company && (
                      <Text
                        style={{ color: colors.textSecondary, fontSize: 11 }}
                        numberOfLines={1}
                      >
                        {company.groupe}
                      </Text>
                    )}
                    {item.nextFollowUp && (
                      <Text
                        style={{
                          color: isOverdue ? colors.error : colors.textSecondary,
                          fontSize: 11,
                          marginTop: 4,
                          fontWeight: isOverdue ? "600" : "400",
                        }}
                      >
                        {isOverdue ? "\u26d4 " : ""}{item.nextFollowUp}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.cardList}
              showsVerticalScrollIndicator={false}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  boardContent: { padding: 12, gap: 10 },
  column: {
    width: COLUMN_WIDTH,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  colHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 2,
    gap: 8,
  },
  colTitle: { fontSize: 14, fontWeight: "700", flex: 1 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },
  cardList: { padding: 8, gap: 6, paddingBottom: 20 },
  card: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cardName: { fontSize: 13, fontWeight: "600" },
});
