import type { ExamAction, ExamDetailDto, ExamStatus, ExamSummaryDto } from "@deephaus/api-client";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import type { NativeMenuItem } from "@/components/ui/menu-sheet";
import { NativeContextMenu, NativeMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { api } from "@/lib/api";
import {
  compareExams,
  examCountdown,
  examReadyLine,
  formatExamDate,
  formatRecall,
  isCramWindow,
} from "@/lib/exams";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

const SECTIONS: { status: ExamStatus; title: string | null }[] = [
  { status: "active", title: null },
  { status: "completed", title: "Completed" },
  { status: "archived", title: "Archived" },
];

export default function ExamsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const online = useOnline();
  const [exams, setExams] = useState<ExamSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameExam, setRenameExam] = useState<ExamSummaryDto | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { exams: items } = await offlineData.listExams();
      setExams(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your exams.");
      setExams([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Loads on first show and again on every return (one load each time).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const sorted = exams.slice().sort(compareExams);
    return SECTIONS.map((section) => ({
      ...section,
      exams: sorted.filter((exam) => exam.status === section.status),
    })).filter((section) => section.exams.length > 0);
  }, [exams]);

  const applyDetail = useCallback((detail: ExamDetailDto) => {
    setExams((prev) => prev.map((exam) => (exam.id === detail.exam.id ? detail.exam : exam)));
  }, []);

  /** Exams are read-only offline, so say so before a change is attempted. */
  function requireConnection(): boolean {
    if (online) return true;
    Alert.alert("You're offline", "Changing an exam needs a connection.");
    return false;
  }

  async function runRename(exam: ExamSummaryDto, nextName: string) {
    const next = nextName.trim();
    if (!next) {
      Alert.alert("Name required", "Enter a name for this exam.");
      return;
    }
    if (next === exam.name.trim() || !requireConnection()) return;
    setBusyId(exam.id);
    try {
      applyDetail(await api.updateExam(exam.id, { name: next }));
      haptics.success();
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(exam: ExamSummaryDto, action: ExamAction) {
    if (busyId || !requireConnection()) return;
    setBusyId(exam.id);
    try {
      applyDetail(await api.runExamAction(exam.id, action));
      haptics.success();
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(exam: ExamSummaryDto) {
    if (!requireConnection()) return;
    Alert.alert(
      "Delete exam",
      `"${exam.name}" will be deleted. Your cards and their review history stay as they are.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusyId(exam.id);
              try {
                await api.deleteExam(exam.id);
                setExams((prev) => prev.filter((item) => item.id !== exam.id));
                haptics.success();
              } catch (e) {
                Alert.alert("Delete failed", e instanceof Error ? e.message : "Unknown error");
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  }

  function examMenu(exam: ExamSummaryDto): NativeMenuItem[] {
    const items: NativeMenuItem[] = [];
    if (exam.status === "active" && exam.ready_now > 0) {
      items.push({
        label: "Study now",
        sfIcon: "book",
        onPress: () => router.push(`/study/exam/${exam.id}`),
      });
    }
    items.push({
      label: "Rename",
      sfIcon: "pencil",
      onPress: () => setRenameExam(exam),
    });
    items.push({
      label: exam.status === "archived" ? "Unarchive" : "Archive",
      sfIcon: exam.status === "archived" ? "tray.and.arrow.up" : "archivebox",
      onPress: () => void runAction(exam, exam.status === "archived" ? "unarchive" : "archive"),
    });
    items.push({
      label: "Delete",
      sfIcon: "trash",
      destructive: true,
      onPress: () => confirmDelete(exam),
    });
    return items.map((item) => ({ ...item, disabled: item.disabled || busyId != null }));
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        sidebar
        title="Exams"
        actions={[
          {
            icon: "add",
            sfIcon: "plus",
            label: "Add exam",
            onPress: () => router.push("/exams/create"),
          },
        ]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.accent}
            />
          }
        >
          {error && (
            <View style={styles.empty}>
              <FeaturedIcon icon="warning" variant="again" size="md" />
              <Text style={styles.emptyTitle}>Could not load exams</Text>
              <Text style={styles.emptyBody}>{error}</Text>
              <Button
                variant="secondary"
                size="md"
                label="Try again"
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          {!error && exams.length === 0 && (
            <View style={styles.empty}>
              <FeaturedIcon icon="calendar" variant="brand" size="lg" />
              <Text style={styles.emptyTitle}>No exams yet</Text>
              <Text style={styles.emptyBody}>
                Add an exam with its date and the decks it covers. You'll see where you stand
                and what to study each day until then.
              </Text>
              <Button
                variant="primary"
                size="md"
                label="Add exam"
                leadingIcon="add"
                onPress={() => router.push("/exams/create")}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          {sections.map((section) => (
            <View key={section.status} style={styles.section}>
              {section.title ? (
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {section.title}
                </Text>
              ) : null}
              <View style={styles.list}>
                {section.exams.map((exam) => {
                  const menu = examMenu(exam);
                  return (
                    <NativeContextMenu key={exam.id} label={exam.name} entries={menu}>
                      {({ onLongPress }) => (
                        <View style={styles.exam}>
                          <Pressable
                            onPress={() => router.push(`/exams/${exam.id}`)}
                            onLongPress={onLongPress}
                            accessibilityRole="button"
                            style={({ pressed }) => [styles.examBody, pressed && { opacity: 0.6 }]}
                          >
                            <ExamRowText exam={exam} />
                          </Pressable>
                          {busyId === exam.id ? (
                            <View style={styles.moreBtn}>
                              <ActivityIndicator size="small" color={colors.accent} />
                            </View>
                          ) : (
                            <NativeMenu label={`Actions for ${exam.name}`} entries={menu}>
                              <View style={styles.moreBtn}>
                                <Icon name="more" size={18} color={colors.fgTertiary} />
                              </View>
                            </NativeMenu>
                          )}
                        </View>
                      )}
                    </NativeContextMenu>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <TextPromptModal
        visible={renameExam != null}
        title="Rename exam"
        placeholder="Exam name"
        initialValue={renameExam?.name ?? ""}
        onSubmit={(value) => {
          if (renameExam) void runRename(renameExam, value);
        }}
        onClose={() => setRenameExam(null)}
      />
    </View>
  );
}

/** Name, when, where it stands, and what there is to study now. */
function ExamRowText({ exam }: { exam: ExamSummaryDto }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const when = `${formatExamDate(exam)} · ${examCountdown(exam.exam_at)}`;
  const active = exam.status === "active";
  const hasCards = exam.snapshot.total > 0;

  return (
    <>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {exam.name}
        </Text>
        {active && isCramWindow(exam.exam_at) ? <BadgePill label="Cram" tone="orange" /> : null}
      </View>
      <Text style={styles.metaText} numberOfLines={1}>
        {when}
      </Text>
      {active ? (
        hasCards ? (
          <>
            <Text style={styles.metaText} numberOfLines={1}>
              <Text style={styles.metaStrong}>{formatRecall(exam.snapshot.recall_now)}</Text> if
              the exam were now
            </Text>
            <Text
              style={[styles.metaText, exam.ready_now > 0 && styles.metaReady]}
              numberOfLines={1}
            >
              {examReadyLine(exam)}
            </Text>
          </>
        ) : (
          <Text style={styles.metaText} numberOfLines={1}>
            No cards in the decks this exam covers
          </Text>
        )
      ) : exam.result_score != null ? (
        <Text style={styles.metaText} numberOfLines={1}>
          Your result: <Text style={styles.metaStrong}>{Math.round(exam.result_score)}%</Text>
        </Text>
      ) : exam.status === "completed" ? (
        <Text style={styles.metaText} numberOfLines={1}>
          How did it go?
        </Text>
      ) : null}
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { paddingTop: 8, paddingBottom: 32, gap: 20 },
    empty: {
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 32,
      paddingVertical: 40,
    },
    emptyTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
    },
    emptyBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    section: { gap: 8 },
    sectionTitle: {
      marginHorizontal: 24,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    list: { marginHorizontal: 20, gap: 10 },
    exam: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    examBody: {
      flex: 1,
      minWidth: 0,
      gap: 3,
      paddingVertical: 14,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 1,
    },
    title: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    moreBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    metaText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    metaStrong: {
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    metaReady: {
      fontWeight: "500",
      color: colors.fgSecondary,
    },
  });
}
