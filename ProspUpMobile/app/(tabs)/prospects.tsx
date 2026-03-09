import { useMemo, useCallback } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Text,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useTheme } from "../../hooks/useTheme";
import { useProspects, useSaveProspect } from "../../hooks/useProspects";
import { ProspectCard } from "../../components/ProspectCard";
import { SwipeableRow } from "../../components/SwipeableRow";
import { EmptyState } from "../../components/EmptyState";
import { getNextStatus } from "../../constants/statuses";
import type { Prospect, Company } from "../../services/types";

export default function ProspectsScreen() {
  const colors = useTheme();
  const router = useRouter();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useProspects();
  const saveMutation = useSaveProspect();

  // Flatten pages
  const { prospects, companiesMap } = useMemo(() => {
    const all: Prospect[] = [];
    const cMap = new Map<number, Company>();
    for (const page of data?.pages ?? []) {
      for (const c of page.companies ?? []) cMap.set(c.id, c);
      for (const p of page.prospects ?? []) all.push(p);
    }
    return { prospects: all, companiesMap: cMap };
  }, [data]);

  const handleCall = useCallback((prospect: Prospect) => {
    if (prospect.telephone) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(`tel:${prospect.telephone}`);
    }
  }, []);

  const handleCycleStatus = useCallback(
    (prospect: Prospect) => {
      const next = getNextStatus(prospect.statut);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      saveMutation.mutate({
        prospects: [{ ...prospect, statut: next }],
      });
    },
    [saveMutation]
  );

  const renderItem = useCallback(
    ({ item }: { item: Prospect }) => {
      const company = companiesMap.get(item.company_id);
      return (
        <SwipeableRow
          onSwipeLeft={item.telephone ? () => handleCall(item) : undefined}
          onSwipeRight={() => handleCycleStatus(item)}
          leftLabel={"\ud83d\udcde Appeler"}
          rightLabel={"\ud83d\udd04 Statut"}
        >
          <ProspectCard prospect={item} companyName={company?.groupe} />
        </SwipeableRow>
      );
    },
    [companiesMap, handleCall, handleCycleStatus]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header actions */}
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => router.push("/kanban")}
          >
            <Text style={{ color: colors.accent, fontWeight: "600" }}>
              {"\ud83d\udcca"} Kanban
            </Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {prospects.length} prospect{prospects.length > 1 ? "s" : ""}
          </Text>
        </View>

        <FlatList
          data={prospects}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ padding: 16 }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            isLoading ? null : (
              <EmptyState
                emoji={"\ud83d\udcad"}
                title="Aucun prospect"
                subtitle="Ajoutez votre premier prospect depuis le web"
              />
            )
          }
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  list: { padding: 16, paddingTop: 0 },
});
