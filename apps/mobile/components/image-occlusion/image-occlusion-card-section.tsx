import {
  buildOcclusionCardFront,
  imageUrlFromCardFields,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  cardId: string;
  front: string;
  back: string;
  occlusionData: unknown;
  disabled?: boolean;
  onChange: (patch: {
    type: "image-occlusion";
    front: string;
    back: string | null;
    occlusion_data: ImageOcclusionData;
  }) => void;
};

function headerFromFront(front: string | null | undefined): string {
  return (front ?? "").replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
}

export function ImageOcclusionCardSection({
  cardId,
  front,
  back,
  occlusionData,
  disabled,
  onChange,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const imageUrl = useMemo(
    () => parseImageOcclusionData(occlusionData)?.imageUrl ?? imageUrlFromCardFields(front, back),
    [occlusionData, front, back],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [data, setData] = useState<ImageOcclusionData | null>(() => {
    const parsed = parseImageOcclusionData(occlusionData);
    if (parsed) return parsed;
    if (imageUrl) return { imageUrl, rects: [] };
    return null;
  });
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [header, setHeader] = useState(() => headerFromFront(front));

  const lastEmittedRef = useRef<string | null>(null);
  const userEditRef = useRef(false);
  const cardIdRef = useRef(cardId);

  const emit = useCallback(
    (next: ImageOcclusionData, nextHeader = header) => {
      lastEmittedRef.current = JSON.stringify(next);
      onChangeRef.current({
        type: "image-occlusion",
        front: buildOcclusionCardFront(next.imageUrl, nextHeader),
        back: back || null,
        occlusion_data: next,
      });
    },
    [back, header],
  );

  useEffect(() => {
    const isNewCard = cardIdRef.current !== cardId;
    if (isNewCard) {
      cardIdRef.current = cardId;
      userEditRef.current = false;
      const parsed = parseImageOcclusionData(occlusionData);
      const nextData = parsed ?? (imageUrl ? { imageUrl, rects: [] } : null);
      setData(nextData);
      setHeader(headerFromFront(front));
      lastEmittedRef.current = nextData ? JSON.stringify(nextData) : null;
      return;
    }
    if (userEditRef.current) return;
  }, [cardId, occlusionData, imageUrl, front]);

  const handleEditorChange = useCallback((next: ImageOcclusionData) => {
    userEditRef.current = true;
    setData(next);
  }, []);

  useEffect(() => {
    if (!data || !userEditRef.current) return;
    const serialized = JSON.stringify(data);
    if (serialized === lastEmittedRef.current) {
      userEditRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      userEditRef.current = false;
      emit(data);
    }, 280);
    return () => clearTimeout(timer);
  }, [data, emit]);

  async function runAutoDetect() {
    setAutoDetecting(true);
    try {
      const result = await api.autoDetectOcclusion(cardId);
      userEditRef.current = false;
      setData(result.occlusion_data);
      emit(result.occlusion_data);
    } finally {
      setAutoDetecting(false);
    }
  }

  if (!imageUrl || !data) {
    return (
      <Text style={styles.hint}>Upload an image on this card first, then set up occlusion regions.</Text>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Card title (optional)</Text>
      <TextInput
        style={styles.input}
        value={header}
        editable={!disabled}
        placeholder="Shown above the image"
        placeholderTextColor={colors.fgQuaternary}
        onChangeText={(value) => {
          setHeader(value);
          emit(data, value);
        }}
      />
      <ImageOcclusionEditor
        data={data}
        disabled={disabled}
        autoDetecting={autoDetecting}
        onAutoDetect={runAutoDetect}
        onChange={handleEditorChange}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { gap: 12 },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.fgPrimary,
      backgroundColor: colors.bgSurface,
    },
    hint: { fontSize: 13, color: colors.fgTertiary, lineHeight: 18 },
  });
}
