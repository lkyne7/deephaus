import {
  clamp01,
  createOcclusionRectId,
  MAX_CLOZE_DELETIONS,
  normalizeOcclusionRect,
  occlusionOrdLabel,
  occlusionRectOrd,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { cardMediaDisplayUrlSized } from "@deephaus/shared";
import Svg, { Rect } from "react-native-svg";
import { Button } from "@/components/ui/button";
import { clozePaletteForOrd } from "@/lib/cloze-colors";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  data: ImageOcclusionData;
  onChange: (data: ImageOcclusionData) => void;
  onAutoDetect?: () => Promise<void>;
  autoDetecting?: boolean;
  disabled?: boolean;
};

type DraftRect = { x: number; y: number; width: number; height: number };

function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): DraftRect {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  return {
    x,
    y,
    width: clamp01(Math.abs(b.x - a.x)),
    height: clamp01(Math.abs(b.y - a.y)),
  };
}

function OcclusionRegionEditInlineMobile({
  rect,
  disabled,
  colorScheme,
  colors,
  styles,
  onOrdChange,
  onHintCommit,
}: {
  rect: OcclusionRect;
  disabled?: boolean;
  colorScheme: "light" | "dark";
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onOrdChange: (ord: number) => void;
  onHintCommit: (hint: string) => void;
}) {
  const ord = occlusionRectOrd(rect);
  const [hintDraft, setHintDraft] = useState(rect.label ?? "");

  useEffect(() => {
    setHintDraft(rect.label ?? "");
  }, [rect.id, rect.label]);

  return (
    <View style={styles.inlineEdit}>
      <View style={styles.clozeOrdRow}>
        {Array.from({ length: MAX_CLOZE_DELETIONS }, (_, i) => i + 1).map((nextOrd) => {
          const palette = clozePaletteForOrd(nextOrd, colorScheme);
          const active = ord === nextOrd;
          return (
            <Pressable
              key={nextOrd}
              disabled={disabled}
              onPress={() => onOrdChange(nextOrd)}
              style={[
                styles.clozeOrdBtn,
                { backgroundColor: palette.bg, borderColor: palette.border },
                active && styles.clozeOrdBtnActive,
              ]}
            >
              <Text style={[styles.clozeOrdBtnText, { color: palette.fg }]}>
                {occlusionOrdLabel(nextOrd)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hintLabel}>Hint</Text>
      <TextInput
        style={styles.hintInput}
        value={hintDraft}
        editable={!disabled}
        placeholder="Optional hint shown when studying"
        placeholderTextColor={colors.fgTertiary}
        onChangeText={setHintDraft}
        onBlur={() => onHintCommit(hintDraft.trim())}
        onSubmitEditing={() => onHintCommit(hintDraft.trim())}
      />
    </View>
  );
}

export function ImageOcclusionEditor({
  data,
  onChange,
  onAutoDetect,
  autoDetecting = false,
  disabled = false,
}: Props) {
  const { colors, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  dataRef.current = data;
  onChangeRef.current = onChange;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingRectId, setEditingRectId] = useState<string | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 200 });
  const [drawing, setDrawing] = useState<DraftRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const applyRects = useCallback((rects: OcclusionRect[]) => {
    onChangeRef.current({
      ...dataRef.current,
      rects: rects.map((r) => normalizeOcclusionRect({ ...r, enabled: true })),
    });
  }, []);

  const patchRect = useCallback((id: string, patch: Partial<OcclusionRect>) => {
    applyRects(
      dataRef.current.rects.map((rect) =>
        rect.id === id ? { ...rect, ...patch } : rect,
      ),
    );
  }, [applyRects]);

  const removeRect = useCallback(
    (id: string) => {
      applyRects(dataRef.current.rects.filter((rect) => rect.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      setEditingRectId((current) => (current === id ? null : current));
    },
    [applyRects],
  );

  const toNorm = useCallback(
    (x: number, y: number) => ({
      x: layout.width > 0 ? clamp01(x / layout.width) : 0,
      y: layout.height > 0 ? clamp01(y / layout.height) : 0,
    }),
    [layout],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const point = toNorm(locationX, locationY);
          startRef.current = point;
          setDrawing({ x: point.x, y: point.y, width: 0, height: 0 });
          setSelectedId(null);
          setEditingRectId(null);
        },
        onPanResponderMove: (evt) => {
          if (!startRef.current) return;
          const { locationX, locationY } = evt.nativeEvent;
          setDrawing(rectFromPoints(startRef.current, toNorm(locationX, locationY)));
        },
        onPanResponderRelease: (evt) => {
          if (!startRef.current) return;
          const { locationX, locationY } = evt.nativeEvent;
          const next = rectFromPoints(startRef.current, toNorm(locationX, locationY));
          startRef.current = null;
          setDrawing(null);
          if (next.width < 0.02 || next.height < 0.02) return;
          const rect = normalizeOcclusionRect({
            id: createOcclusionRectId(),
            ...next,
            enabled: true,
            ord: dataRef.current.rects.find((r) => r.id === selectedId)
              ? occlusionRectOrd(dataRef.current.rects.find((r) => r.id === selectedId)!)
              : 1,
          });
          applyRects([...dataRef.current.rects, rect]);
          setSelectedId(rect.id);
        },
      }),
    [disabled, selectedId, toNorm, applyRects],
  );

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        {onAutoDetect ? (
          <Button
            variant="secondary"
            size="sm"
            label={autoDetecting ? "Detecting…" : "Auto-occlude"}
            onPress={() => void onAutoDetect()}
            disabled={disabled || autoDetecting}
          />
        ) : null}
        <Button
          variant="tertiary"
          size="sm"
          label="Clear"
          onPress={() => {
            applyRects([]);
            setSelectedId(null);
            setEditingRectId(null);
          }}
          disabled={disabled || data.rects.length === 0}
        />
      </View>

      <View
        style={styles.canvas}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0) setLayout({ width, height: Math.max(height, 180) });
        }}
        {...panResponder.panHandlers}
      >
        <Image
          source={{ uri: cardMediaDisplayUrlSized(data.imageUrl, "preview") }}
          style={{ width: layout.width || "100%", height: layout.height }}
          resizeMode="contain"
        />
        <Svg style={StyleSheet.absoluteFill} width={layout.width} height={layout.height}>
          {data.rects.map((rect) => {
            const ord = occlusionRectOrd(rect);
            const palette = clozePaletteForOrd(ord, colorScheme);
            const isSelected = rect.id === selectedId;
            return (
              <Rect
                key={rect.id}
                x={rect.x * layout.width}
                y={rect.y * layout.height}
                width={rect.width * layout.width}
                height={rect.height * layout.height}
                rx={6}
                fill={palette.bg}
                stroke={isSelected ? palette.fg : palette.border}
                strokeWidth={isSelected ? 3 : 2}
                fillOpacity={0.85}
              />
            );
          })}
          {drawing ? (
            <Rect
              x={drawing.x * layout.width}
              y={drawing.y * layout.height}
              width={drawing.width * layout.width}
              height={drawing.height * layout.height}
              rx={6}
              fill="rgba(79,179,177,0.35)"
              stroke={colors.brand700}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
        {autoDetecting ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.brand500} />
          </View>
        ) : null}
      </View>

      <View style={styles.segmentBox}>
        <ScrollView style={{ maxHeight: 200 }}>
          {data.rects.length === 0 ? (
            <Text style={styles.emptyHint}>
              Drag on the image or use Auto-occlude to add regions.
            </Text>
          ) : (
            data.rects.map((rect, index) => {
              const ord = occlusionRectOrd(rect);
              const palette = clozePaletteForOrd(ord, colorScheme);
              const hint = rect.label?.trim();
              const active = rect.id === selectedId;
              const editing = rect.id === editingRectId;
              return (
                <Pressable
                  key={rect.id}
                  onPress={() => {
                    setSelectedId(rect.id);
                    setEditingRectId(null);
                  }}
                  style={[styles.segmentRow, active && styles.segmentRowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Pressable
                        disabled={disabled}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          if (editing) setEditingRectId(null);
                          else {
                            setSelectedId(rect.id);
                            setEditingRectId(rect.id);
                          }
                        }}
                        style={[
                          styles.ordBadge,
                          {
                            backgroundColor: palette.bg,
                            borderColor: palette.border,
                          },
                          editing && styles.ordBadgeEditing,
                        ]}
                      >
                        <Text style={[styles.ordBadgeText, { color: palette.fg }]}>
                          {occlusionOrdLabel(ord)}
                        </Text>
                      </Pressable>
                      <Text style={styles.segmentRef}>Region {index + 1}</Text>
                    </View>
                    {hint && !editing ? <Text style={styles.segmentPreview}>{hint}</Text> : null}
                    {editing ? (
                      <OcclusionRegionEditInlineMobile
                        rect={rect}
                        disabled={disabled}
                        colorScheme={colorScheme}
                        colors={colors}
                        styles={styles}
                        onOrdChange={(nextOrd) => patchRect(rect.id, { ord: nextOrd })}
                        onHintCommit={(label) => patchRect(rect.id, { label: label || undefined })}
                      />
                    ) : null}
                  </View>
                  <Pressable onPress={() => removeRect(rect.id)}>
                    <Text style={styles.link}>Remove</Text>
                  </Pressable>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { gap: 12 },
    toolbar: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    canvas: {
      width: "100%",
      minHeight: 180,
      borderRadius: radius.xl,
      overflow: "hidden",
      backgroundColor: colors.gray100,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    busy: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.5)",
    },
    segmentBox: {
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.xl,
      overflow: "hidden",
      backgroundColor: colors.bgSurface,
    },
    segmentRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSecondary,
    },
    segmentRowActive: {
      backgroundColor: colors.brand50,
    },
    ordBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
    },
    ordBadgeEditing: {
      borderWidth: 2,
      borderColor: colors.fgPrimary,
    },
    inlineEdit: {
      marginTop: 8,
      gap: 6,
      padding: 10,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.gray50,
    },
    ordBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    segmentRef: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    clozeOrdRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    clozeOrdBtn: {
      minWidth: 36,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    clozeOrdBtnActive: {
      borderWidth: 2,
      borderColor: colors.fgPrimary,
    },
    clozeOrdBtnText: {
      fontSize: 12,
      fontWeight: "700",
    },
    segmentPreview: {
      fontSize: 12,
      color: colors.fgTertiary,
      marginTop: 2,
    },
    hint: { fontSize: 12, color: colors.fgTertiary },
    emptyHint: {
      padding: 16,
      fontSize: 13,
      color: colors.fgTertiary,
      lineHeight: 18,
    },
    link: { fontSize: 13, fontWeight: "500", color: colors.brand700 },
    hintLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    hintInput: {
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.fgPrimary,
      backgroundColor: colors.bgSurface,
    },
  });
}
