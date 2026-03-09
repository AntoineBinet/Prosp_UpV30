import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";
import { useDashboard } from "../../hooks/useDashboard";
import { KPICard } from "../../components/KPICard";
import { StatusBadge } from "../../components/StatusBadge";

export default function DashboardScreen() {
  const colors = useTheme();
  const { user, signOut } = useAuth();
  const { data, isLoading, refetch, isRefetching } = useDashboard();
  const router = useRouter();

  const trend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Welcome */}
      <View style={styles.welcomeRow}>
        <Text style={[styles.welcome, { color: colors.text }]}>
          Bonjour, {user?.name ?? ""}
        </Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
            Deconnexion
          </Text>
        </TouchableOpacity>
      </View>

      {/* Relance alert */}
      {data && (data.pipeline.overdue > 0 || data.pipeline.due_today > 0) && (
        <TouchableOpacity
          style={[styles.alert, { backgroundColor: data.pipeline.overdue > 0 ? colors.error + "20" : colors.warning + "20", borderColor: data.pipeline.overdue > 0 ? colors.error : colors.warning }]}
          onPress={() => router.push("/(tabs)/focus")}
          activeOpacity={0.7}
        >
          <Text style={{ color: data.pipeline.overdue > 0 ? colors.error : colors.warning, fontWeight: "600", fontSize: 14 }}>
            {data.pipeline.overdue > 0
              ? `\u26d4 ${data.pipeline.overdue} relance(s) en retard`
              : `\ud83d\udccc ${data.pipeline.due_today} relance(s) aujourd'hui`}
          </Text>
        </TouchableOpacity>
      )}

      {/* KPIs */}
      {data && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.kpiRow}
          contentContainerStyle={styles.kpiContent}
        >
          <KPICard
            label="Contacts"
            value={data.today.contacts}
            trend={trend(data.week.contacts, data.prev_week.contacts)}
          />
          <KPICard
            label="Notes"
            value={data.today.notes}
            trend={trend(data.week.notes, data.prev_week.notes)}
          />
          <KPICard
            label="Push"
            value={data.today.push_total}
            trend={trend(data.week.push_total, data.prev_week.push_total)}
          />
          <KPICard
            label="RDV Pipeline"
            value={data.pipeline.rdv}
          />
          <KPICard
            label="Total Pipeline"
            value={data.pipeline.total}
          />
        </ScrollView>
      )}

      {/* Pipeline breakdown */}
      {data && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Pipeline
          </Text>
          {Object.entries(data.pipeline.statuts).map(([status, count]) => (
            <View key={status} style={styles.pipelineRow}>
              <StatusBadge status={status} />
              <Text style={[styles.pipelineCount, { color: colors.text }]}>
                {count as number}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Overdue list */}
      {data && data.overdue_list.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.error }]}>
            Relances en retard
          </Text>
          {data.overdue_list.slice(0, 5).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.listItem}
              onPress={() => router.push(`/prospect/${p.id}`)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.text }]}>
                  {p.name}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {p.nextFollowUp}
                </Text>
              </View>
              <StatusBadge status={p.statut} small />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Upcoming RDV */}
      {data && data.upcoming_rdv.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            RDV a venir
          </Text>
          {data.upcoming_rdv.slice(0, 5).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.listItem}
              onPress={() => router.push(`/prospect/${p.id}`)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.text }]}>
                  {p.name}
                </Text>
                <Text style={{ color: colors.accent, fontSize: 12 }}>
                  {p.rdvDate}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent activity */}
      {data && data.feed.notes.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Activite recente
          </Text>
          {data.feed.notes.slice(0, 5).map((note, i) => (
            <TouchableOpacity
              key={`note-${i}`}
              style={styles.listItem}
              onPress={() => router.push(`/prospect/${note.prospect_id}`)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.text }]}>
                  {note.prospect_name}
                </Text>
                <Text
                  style={{ color: colors.textSecondary, fontSize: 12 }}
                  numberOfLines={2}
                >
                  {note.content}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                {note.date?.slice(0, 10)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isLoading && !data && (
        <Text style={{ color: colors.textSecondary, textAlign: "center", marginTop: 40 }}>
          Chargement...
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  welcomeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  welcome: { fontSize: 20, fontWeight: "700" },
  alert: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  kpiRow: { marginBottom: 16 },
  kpiContent: { gap: 10, paddingRight: 8 },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  pipelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  pipelineCount: { fontSize: 16, fontWeight: "600" },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  itemName: { fontSize: 14, fontWeight: "600" },
});
