import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  SectionList,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../hooks/useTheme";
import { useSearch } from "../../hooks/useSearch";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState } from "../../components/EmptyState";

export default function SearchScreen() {
  const colors = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(text.trim()), 300);
  }, []);

  const { data, isLoading } = useSearch(debouncedQuery);

  // Build sections
  const sections: { title: string; data: any[] }[] = [];
  if (data) {
    if (data.prospects.length > 0)
      sections.push({ title: `Prospects (${data.counts.prospects})`, data: data.prospects.map((p) => ({ ...p, _type: "prospect" })) });
    if (data.companies.length > 0)
      sections.push({ title: `Entreprises (${data.counts.companies})`, data: data.companies.map((c) => ({ ...c, _type: "company" })) });
    if (data.candidates.length > 0)
      sections.push({ title: `Candidats (${data.counts.candidates})`, data: data.candidates.map((c) => ({ ...c, _type: "candidate" })) });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>{"\ud83d\udd0d"}</Text>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Rechercher..."
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={handleChange}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item, i) => `${item._type}-${item.id}-${i}`}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.resultCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              if (item._type === "prospect") {
                router.push(`/prospect/${item.id}`);
              }
            }}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultName, { color: colors.text }]} numberOfLines={1}>
                {item.name || item.groupe || ""}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
                {item._type === "prospect"
                  ? [item.company_groupe, item.fonction].filter(Boolean).join(" \u2022 ")
                  : item._type === "company"
                    ? item.site || ""
                    : item.role || item.location || ""}
              </Text>
            </View>
            {item._type === "prospect" && item.statut && (
              <StatusBadge status={item.statut} small />
            )}
            {item._type !== "prospect" && (
              <Text style={[styles.typeLabel, { color: colors.textSecondary, backgroundColor: colors.background }]}>
                {item._type === "company" ? "Entreprise" : "Candidat"}
              </Text>
            )}
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          debouncedQuery.length >= 2 && !isLoading ? (
            <EmptyState
              emoji={"\ud83d\udcad"}
              title="Aucun resultat"
              subtitle={`Aucun resultat pour "${debouncedQuery}"`}
            />
          ) : debouncedQuery.length < 2 ? (
            <EmptyState
              emoji={"\ud83d\udd0d"}
              title="Recherche globale"
              subtitle="Tapez au moins 2 caracteres pour rechercher"
            />
          ) : null
        }
        stickySectionHeadersEnabled={false}
      />

      {isLoading && debouncedQuery.length >= 2 && (
        <Text style={{ color: colors.textSecondary, textAlign: "center", padding: 16 }}>
          Recherche...
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 16, height: 28 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
    gap: 8,
  },
  resultName: { fontSize: 14, fontWeight: "600" },
  typeLabel: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: "500",
  },
});
