import {
  buildOcclusionCardFront,
  imageUrlFromCardFields,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [header, setHeader] = useState(() => headerFromFront(front));

  const cardIdRef = useRef(cardId);

  const emit = useCallback(
    (next: ImageOcclusionData, nextHeader = header) => {
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
      const parsed = parseImageOcclusionData(occlusionData);
      const nextData = parsed ?? (imageUrl ? { imageUrl, rects: [] } : null);
      setData(nextData);
      setHeader(headerFromFront(front));
      setUploadError(null);
      return;
    }
  }, [cardId, occlusionData, imageUrl, front]);

  const handleEditorChange = useCallback((next: ImageOcclusionData) => {
    setData(next);
    emit(next);
  }, [emit]);

  async function pickAndUploadImage() {
    if (disabled || uploading) return;
    setUploadError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const filename = asset.fileName ?? "image.jpg";
      const { url } = await api.uploadCardMedia(cardId, blob, filename);
      const next: ImageOcclusionData = { imageUrl: url, rects: [] };
      setData(next);
      emit(next);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function runAutoDetect() {
    setAutoDetecting(true);
    try {
      const result = await api.autoDetectOcclusion(cardId);
      setData(result.occlusion_data);
      emit(result.occlusion_data);
    } finally {
      setAutoDetecting(false);
    }
  }

  if (!imageUrl || !data) {
    return (
      <View style={styles.emptyRoot}>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          label="Upload an image"
          leadingIcon="image"
          loading={uploading}
          disabled={disabled}
          onPress={() => void pickAndUploadImage()}
        />
        <Text style={styles.uploadHint}>Choose a photo to set up occlusion regions</Text>
        {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <View style={styles.titleField}>
          <Text style={styles.label}>Card title (optional)</Text>
          <TextInput
            style={styles.input}
            value={header}
            editable={!disabled && !uploading}
            placeholder="Shown above the image"
            placeholderTextColor={colors.fgPlaceholder}
            selectionColor={colors.accent}
            onChangeText={(value) => {
              setHeader(value);
              emit(data, value);
            }}
          />
        </View>
        <Button
          variant="secondary"
          label="Change"
          loading={uploading}
          disabled={disabled}
          onPress={() => void pickAndUploadImage()}
        />
      </View>
      <ImageOcclusionEditor
        data={data}
        disabled={disabled || uploading}
        autoDetecting={autoDetecting}
        onAutoDetect={runAutoDetect}
        onChange={handleEditorChange}
      />
      {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { gap: 12 },
    emptyRoot: { gap: 10 },
    uploadHint: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
    },
    titleField: { flex: 1, gap: 6 },
    label: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.xl,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.fgPrimary,
      backgroundColor: colors.bgSurface,
    },
    error: {
      fontSize: 13,
      color: colors.danger,
      lineHeight: 18,
    },
  });
}
