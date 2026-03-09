import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "../../hooks/useTheme";
import { useProspects, useSaveProspect } from "../../hooks/useProspects";
import { api } from "../../services/api";
import { StatusBadge } from "../../components/StatusBadge";
import { PertinenceStars } from "../../components/PertinenceStars";
import { MarkDoneModal } from "../../components/MarkDoneModal";
import { STATUSES } from "../../constants/statuses";
import type { Prospect, Company, TimelineEvent } from "../../services/types";

type Tab = "info" | "timeline" | "edit";

export default function ProspectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [showMarkDone, setShowMarkDone] = useState(false);

  const prospectId = Number(id);

  // Find prospect from cached data
  const prospectQuery = useProspects();
  const { prospect, company } = useMemo(() => {
    let p: Prospect | undefined;
    let c: Company | undefined;
    const cMap = new Map<number, Company>();
    for (const page of prospectQuery.data?.pages ?? []) {
      for (const co of page.companies ?? []) cMap.set(co.id, co);
      for (const pr of page.prospects ?? []) {
        if (pr.id === prospectId) p = pr;
      }
    }
    if (p) c = cMap.get(p.company_id);
    return { prospect: p, company: c };
  }, [prospectQuery.data, prospectId]);

  // Timeline
  const timelineQuery = useQuery({
    queryKey: ["timeline", prospectId],
    queryFn: () =>
      api.get<{ ok: boolean; events: TimelineEvent[] }>(
        `/api/prospect/timeline?id=${prospectId}`
      ),
    select: (res) => res.events,
    staleTime: 60_000,
  });

  const saveMutation = useSaveProspect();

  const copyEmail = async () => {
    if (prospect?.email) {
      await Clipboard.setStringAsync(prospect.email);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Copie", `${prospect.email} copie dans le presse-papier`);
    }
  };

  const changeStatus = (newStatus: string) => {
    if (!prospect) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveMutation.mutate({
      prospects: [{ ...prospect, statut: newStatus }],
    });
  };

  if (!prospect) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Prospect" }} />
        <Text style={{ color: colors.textSecondary, textAlign: "center", marginTop: 60 }}>
          Chargement...
        </Text>
      </View>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "info", label: "Info" },
    { key: "timeline", label: "Timeline" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: prospect.name }} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              prospectQuery.refetch();
              timelineQuery.refetch();
            }}
          />
        }
      >
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.name, { color: colors.text }]}>
            {prospect.name}
          </Text>
          {prospect.fonction && (
            <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 2 }}>
              {prospect.fonction}
            </Text>
          )}
          {company && (
            <Text style={{ color: colors.accent, fontSize: 14, marginTop: 2 }}>
              {company.groupe} - {company.site}
            </Text>
          )}
          <View style={styles.heroRow}>
            <StatusBadge
              status={prospect.statut}
              onPress={() => {
                Alert.alert(
                  "Changer statut",
                  undefined,
                  STATUSES.map((s) => ({
                    text: `${s.emoji} ${s.label}`,
                    onPress: () => changeStatus(s.key),
                  }))
                );
              }}
            />
            <PertinenceStars value={prospect.pertinence} />
          </View>
          {prospect.nextAction && (
            <View style={[styles.nextAction, { backgroundColor: colors.accent + "15" }]}>
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
                {"\u27a4"} {prospect.nextAction}
              </Text>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && {
                  borderBottomColor: colors.accent,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={{
                  color: activeTab === tab.key ? colors.accent : colors.textSecondary,
                  fontWeight: activeTab === tab.key ? "700" : "400",
                  fontSize: 14,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === "info" && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {prospect.email && (
              <InfoRow
                label="Email"
                value={prospect.email}
                colors={colors}
                onPress={copyEmail}
              />
            )}
            {prospect.telephone && (
              <InfoRow
                label="T\u00e9l\u00e9phone"
                value={prospect.telephone}
                colors={colors}
                onPress={() => Linking.openURL(`tel:${prospect.telephone}`)}
              />
            )}
            {prospect.linkedin && (
              <InfoRow label="LinkedIn" value={prospect.linkedin} colors={colors} />
            )}
            {prospect.tags && prospect.tags.length > 0 && (
              <View style={styles.infoRow}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Tags
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {prospect.tags.map((t, i) => (
                    <Text
                      key={i}
                      style={{
                        backgroundColor: colors.accent + "20",
                        color: colors.accent,
                        fontSize: 12,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 4,
                      }}
                    >
                      {t}
                    </Text>
                  ))}
                </View>
              </View>
            )}
            {prospect.nextFollowUp && (
              <InfoRow
                label="Prochaine relance"
                value={prospect.nextFollowUp}
                colors={colors}
              />
            )}
            {prospect.lastContact && (
              <InfoRow
                label="Dernier contact"
                value={prospect.lastContact}
                colors={colors}
              />
            )}
            {prospect.rdvDate && (
              <InfoRow
                label="Date RDV"
                value={prospect.rdvDate}
                colors={colors}
              />
            )}
            {prospect.notes && (
              <View style={styles.infoRow}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Notes
                </Text>
                <Text style={{ color: colors.text, fontSize: 14 }}>
                  {prospect.notes}
                </Text>
              </View>
            )}
          </View>
        )}

        {activeTab === "timeline" && (
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {(timelineQuery.data ?? []).length === 0 && (
              <Text style={{ color: colors.textSecondary, textAlign: "center", padding: 20 }}>
                Aucune interaction
              </Text>
            )}
            {(timelineQuery.data ?? []).map((evt, i) => (
              <View key={i} style={styles.timelineItem}>
                <View style={[styles.dot, { backgroundColor: evt.type === "push" ? colors.accent : evt.type === "call_note" ? colors.success : colors.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.timelineTitle, { color: colors.text }]}>
                    {evt.title}
                  </Text>
                  {evt.content && (
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }} numberOfLines={3}>
                      {evt.content}
                    </Text>
                  )}
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                    {evt.date?.slice(0, 16).replace("T", " ")}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {prospect.telephone && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.success }]}
            onPress={() => Linking.openURL(`tel:${prospect.telephone}`)}
          >
            <Text style={styles.actionBtnText}>{"\ud83d\udcde"} Appeler</Text>
          </TouchableOpacity>
        )}
        {prospect.email && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.accent }]}
            onPress={copyEmail}
          >
            <Text style={styles.actionBtnText}>{"\u2709\ufe0f"} Email</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: colors.warning }]}
          onPress={() => setShowMarkDone(true)}
        >
          <Text style={styles.actionBtnText}>{"\u2705"} Fait</Text>
        </TouchableOpacity>
      </View>

      <MarkDoneModal
        visible={showMarkDone}
        prospectId={prospect.id}
        prospectName={prospect.name}
        onClose={() => setShowMarkDone(false)}
      />
    </View>
  );
}

function InfoRow({
  label,
  value,
  colors,
  onPress,
}: {
  label: string;
  value: string;
  colors: any;
  onPress?: () => void;
}) {
  const content = (
    <View style={infoStyles.row}>
      <Text style={[infoStyles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[
          infoStyles.value,
          { color: onPress ? colors.accent : colors.text },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
  if (onPress)
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  return content;
}

const infoStyles = StyleSheet.create({
  row: { paddingVertical: 8 },
  label: { fontSize: 12, marginBottom: 2 },
  value: { fontSize: 15 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 100 },
  hero: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  name: { fontSize: 20, fontWeight: "800" },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
  },
  nextAction: {
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
  },
  tabRow: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 16,
  },
  tab: {
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  infoRow: { paddingVertical: 8 },
  label: { fontSize: 12, marginBottom: 2 },
  timelineItem: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  timelineTitle: { fontSize: 14, fontWeight: "600" },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: 12,
    paddingBottom: 30,
    gap: 8,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
