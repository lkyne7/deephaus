import {
  clamp01,
  createOcclusionRectId,
  MAX_CLOZE_DELETIONS,
  normalizeOcclusionRect,
  occlusionRectOrd,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { cardMediaDisplayUrlSized } from "@deephaus/shared";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";
import { Button } from "@/components/ui/button";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  data: ImageOcclusionData;
  onChange: (data: ImageOcclusionData) => void;
  onAutoDetect?: () => Promise<void>;
  onChangeImage?: () => void;
  uploading?: boolean;
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

/** The number and hint of the selected label, under its row. */
function LabelDetails({
  rect,
  disabled,
  colors,
  styles,
  onOrdChange,
  onHintCommit,
  onRemove,
}: {
  rect: OcclusionRect;
  disabled?: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onOrdChange: (ord: number) => void;
  onHintCommit: (hint: string) => void;
  onRemove: () => void;
}) {
  const ord = occlusionRectOrd(rect);
  const [hintDraft, setHintDraft] = useState(rect.label ?? "");

  useEffect(() => {
    setHintDraft(rect.label ?? "");
  }, [rect.id, rect.label]);

  return (
    <View style={styles.details}>
      <TextInput
        style={styles.hintInput}
        value={hintDraft}
        editable={!disabled}
        placeholder="Hint shown when studying"
        placeholderTextColor={colors.fgPlaceholder}
        selectionColor={colors.accent}
        accessibilityLabel="Hint"
        returnKeyType="done"
        onChangeText={setHintDraft}
        onBlur={() => onHintCommit(hintDraft.trim())}
        onSubmitEditing={() => onHintCommit(hintDraft.trim())}
      />
      <View style={styles.numbers}>
        {Array.from({ length: MAX_CLOZE_DELETIONS }, (_, i) => i + 1).map((next) => {
          const active = ord === next;
          return (
            <Pressable
              key={next}
              disabled={disabled}
              onPress={() => onOrdChange(next)}
              accessibilityRole="button"
              accessibilityLabel={`Number ${next}`}
              accessibilityState={{ selected: active, disabled }}
              hitSlop={4}
              style={[styles.number, active && styles.numberActive]}
            >
              <Text style={[styles.numberText, active && styles.numberTextActive]}>{next}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.detailsFoot}>
        <Text style={styles.note}>Labels with the same number hide together.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove label"
          disabled={disabled}
          onPress={onRemove}
          hitSlop={12}
        >
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ImageOcclusionEditor({
  data,
  onChange,
  onAutoDetect,
  onChangeImage,
  uploading = false,
  autoDetecting = false,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dataRef = useRef(data);
  const onChangeRef = useRef(onChange);
  dataRef.current = data;
  onChangeRef.current = onChange;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Read by the gesture, which must not be rebuilt when its own first touch clears the selection.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const groupWithRef = useRef<string | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 200 });
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<DraftRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setImageAspectRatio(null);
  }, [data.imageUrl]);

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
          groupWithRef.current = selectedIdRef.current;
          const { locationX, locationY } = evt.nativeEvent;
          const point = toNorm(locationX, locationY);
          startRef.current = point;
          setDrawing({ x: point.x, y: point.y, width: 0, height: 0 });
          setSelectedId(null);
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
          if (next.width < 0.02 || next.height < 0.02) {
            // A tap rather than a drag: select the label under it, topmost first.
            const hit = [...dataRef.current.rects]
              .reverse()
              .find(
                (r) =>
                  next.x >= r.x &&
                  next.x <= r.x + r.width &&
                  next.y >= r.y &&
                  next.y <= r.y + r.height,
              );
            if (hit) setSelectedId(hit.id);
            return;
          }
          const groupWith = dataRef.current.rects.find((r) => r.id === groupWithRef.current);
          const rect = normalizeOcclusionRect({
            id: createOcclusionRectId(),
            ...next,
            enabled: true,
            ord: groupWith ? occlusionRectOrd(groupWith) : 1,
          });
          applyRects([...dataRef.current.rects, rect]);
          setSelectedId(rect.id);
        },
        // The page must not take the drag over, but if the system does, don't leave a stray box.
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => {
          startRef.current = null;
          setDrawing(null);
        },
      }),
    [disabled, toNorm, applyRects],
  );

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.canvas,
          imageAspectRatio == null
            ? styles.canvasFallback
            : { aspectRatio: imageAspectRatio },
        ]}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          if (width <= 0 || height <= 0) return;
          setLayout((current) =>
            Math.abs(current.width - width) < 0.5 &&
            Math.abs(current.height - height) < 0.5
              ? current
              : { width, height },
          );
        }}
        {...panResponder.panHandlers}
      >
        <Image
          source={{ uri: cardMediaDisplayUrlSized(data.imageUrl, "preview") }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoad={({ nativeEvent }) => {
            const { width, height } = nativeEvent.source;
            if (width > 0 && height > 0) setImageAspectRatio(width / height);
          }}
        />
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={layout.width} height={layout.height}>
          {data.rects.map((rect) => {
            const selected = rect.id === selectedId;
            const x = rect.x * layout.width;
            const y = rect.y * layout.height;
            return (
              <Fragment key={rect.id}>
                <Rect
                  x={x}
                  y={y}
                  width={rect.width * layout.width}
                  height={rect.height * layout.height}
                  rx={5}
                  fill={colors.accent}
                  fillOpacity={selected ? 0.28 : 0.16}
                  stroke={selected ? colors.fgPrimary : colors.accent}
                  strokeWidth={selected ? 2.5 : 1.5}
                />
                <Circle cx={x} cy={y} r={8} fill={selected ? colors.fgPrimary : colors.accent} />
                <SvgText
                  x={x}
                  y={y + 3.5}
                  fontSize={10}
                  fontWeight="600"
                  textAnchor="middle"
                  fill={selected ? colors.bgCanvas : colors.fgOnBrand}
                >
                  {String(occlusionRectOrd(rect))}
                </SvgText>
              </Fragment>
            );
          })}
          {drawing ? (
            <Rect
              x={drawing.x * layout.width}
              y={drawing.y * layout.height}
              width={drawing.width * layout.width}
              height={drawing.height * layout.height}
              rx={6}
              fill={colors.accent}
              fillOpacity={0.35}
              stroke={colors.accentInk}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
        {autoDetecting ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </View>

      <View style={styles.toolbar}>
        {onAutoDetect ? (
          <Button
            variant="secondary"
            size="sm"
            label={autoDetecting ? "Finding…" : "Find labels"}
            onPress={() => void onAutoDetect()}
            disabled={disabled || autoDetecting}
          />
        ) : null}
        {onChangeImage ? (
          <Button
            variant="secondary"
            size="sm"
            label="Change image"
            loading={uploading}
            onPress={onChangeImage}
            disabled={disabled}
          />
        ) : null}
        <Button
          variant="tertiary"
          size="sm"
          label="Clear"
          onPress={() => {
            applyRects([]);
            setSelectedId(null);
          }}
          disabled={disabled || data.rects.length === 0}
        />
      </View>

      {data.rects.length === 0 ? (
        <Text style={styles.empty}>Drag on the image to cover a label, or use Find labels.</Text>
      ) : (
        <View style={styles.group}>
          {data.rects.map((rect, index) => {
            const hint = rect.label?.trim();
            const selected = rect.id === selectedId;
            return (
              <View
                key={rect.id}
                style={[index > 0 && styles.divided, selected && styles.rowSelected]}
              >
                <Pressable
                  onPress={() => setSelectedId(selected ? null : rect.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected, expanded: selected }}
                  accessibilityLabel={`Label ${index + 1}, number ${occlusionRectOrd(rect)}${hint ? `, hint ${hint}` : ""}`}
                  style={styles.row}
                >
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{occlusionRectOrd(rect)}</Text>
                  </View>
                  <Text style={styles.rowTitle}>Label {index + 1}</Text>
                  <Text style={styles.rowHint} numberOfLines={1}>
                    {selected ? "" : (hint || "Add a hint")}
                  </Text>
                </Pressable>
                {selected ? (
                  <LabelDetails
                    rect={rect}
                    disabled={disabled}
                    colors={colors}
                    styles={styles}
                    onOrdChange={(nextOrd) => patchRect(rect.id, { ord: nextOrd })}
                    onHintCommit={(label) => patchRect(rect.id, { label: label || undefined })}
                    onRemove={() => removeRect(rect.id)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
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
      alignItems: "center",
      justifyContent: "center",
    },
    canvas: {
      width: "100%",
      borderRadius: radius.xl3,
      overflow: "hidden",
      backgroundColor: colors.bgSunken,
      borderWidth: 1,
      borderColor: colors.line,
    },
    canvasFallback: {
      height: 200,
    },
    busy: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgOverlay,
    },
    empty: {
      paddingVertical: 8,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.fgTertiary,
    },
    group: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: radius.xl2,
      overflow: "hidden",
      backgroundColor: colors.bgSurface,
    },
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    rowSelected: { backgroundColor: colors.accentSoft },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 14,
    },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    badgeText: { fontSize: 12, fontWeight: "600", color: colors.accentInk },
    rowTitle: { fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    rowHint: { flex: 1, fontSize: 15, lineHeight: 20, textAlign: "right", color: colors.fgTertiary },
    details: { gap: 10, paddingHorizontal: 14, paddingBottom: 12 },
    hintInput: {
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.xl,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.fgPrimary,
      backgroundColor: colors.bgSurface,
    },
    numbers: { flexDirection: "row", gap: 5 },
    number: {
      flex: 1,
      minWidth: 28,
      height: 34,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgSurface,
    },
    numberActive: { backgroundColor: colors.accent },
    numberText: { fontSize: 15, fontWeight: "500", color: colors.fgPrimary },
    numberTextActive: { color: colors.fgOnBrand },
    detailsFoot: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 },
    note: { flex: 1, fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
    remove: { fontSize: 14, fontWeight: "500", color: colors.danger },
  });
}
