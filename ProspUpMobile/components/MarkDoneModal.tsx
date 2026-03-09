import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useTheme } from "../hooks/useTheme";
import { useMarkDone } from "../hooks/useProspects";
import * as Haptics from "expo-haptics";

interface Props {
  visible: boolean;
  prospectId: number;
  prospectName: string;
  onClose: () => void;
}

export function MarkDoneModal({ visible, prospectId, prospectName, onClose }: Props) {
  const colors = useTheme();
  const markDone = useMarkDone();
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextFollowUp, setNextFollowUp] = useState("");

  const handleSubmit = async () => {
    try {
      await markDone.mutateAsync({
        id: prospectId,
        note: note || undefined,
        nextAction: nextAction || undefined,
        nextFollowUp: nextFollowUp || undefined,
        lastContact: new Date().toISOString().slice(0, 10),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote("");
      setNextAction("");
      setNextFollowUp("");
      onClose();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            Marquer fait
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {prospectName}
          </Text>

          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            placeholder="Note (optionnel)"
            placeholderTextColor={colors.textSecondary}
            value={note}
            onChangeText={setNote}
            multiline
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            placeholder="Prochaine action"
            placeholderTextColor={colors.textSecondary}
            value={nextAction}
            onChangeText={setNextAction}
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            placeholder="Prochaine relance (AAAA-MM-JJ)"
            placeholderTextColor={colors.textSecondary}
            value={nextFollowUp}
            onChangeText={setNextFollowUp}
            keyboardType={Platform.OS === "ios" ? "default" : "default"}
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.background }]}
              onPress={onClose}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>
                Annuler
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.accent }]}
              onPress={handleSubmit}
              disabled={markDone.isPending}
            >
              {markDone.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  Valider
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    minHeight: 44,
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
