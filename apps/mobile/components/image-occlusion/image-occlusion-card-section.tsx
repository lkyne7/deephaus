import {
  buildOcclusionCardFront,
  imageUrlFromCardFields,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
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
      setUploadError(null);
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
      userEditRef.current = false;
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
      userEditRef.current = false;
      setData(result.occlusion_data);
      emit(result.occlusion_data);
    } finally {
      setAutoDetecting(false);
    }
  }

  if (!imageUrl || !data) {
    return (
      <View style={styles.emptyRoot}>
        <Pressable
          style={[styles.uploadBtn, (disabled || uploading) && styles.uploadBtnDisabled]}
          disabled={disabled || uploading}
          onPress={() => void pickAndUploadImage()}
        >
          {uploading ? (
            <ActivityIndicator color={colors.fgPrimary} />
          ) : (
            <Text style={styles.uploadTitle}>Upload an image</Text>
          )}
          <Text style={styles.uploadHint}>Choose a photo to set up occlusion regions</Text>
        </Pressable>
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
            placeholderTextColor={colors.fgQuaternary}
            onChangeText={(value) => {
              setHeader(value);
              emit(data, value);
            }}
          />
        </View>
        <Pressable
          style={[styles.changeBtn, (disabled || uploading) && styles.uploadBtnDisabled]}
          disabled={disabled || uploading}
          onPress={() => void pickAndUploadImage()}
        >
          {uploading ? (
            <ActivityIndicator color={colors.fgPrimary} />
          ) : (
            <Text style={styles.changeBtnText}>Change</Text>
          )}
        </Pressable>
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
    uploadBtn: {
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 140,
      paddingHorizontal: 16,
      paddingVertical: 24,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
    },
    uploadBtnDisabled: { opacity: 0.55 },
    uploadTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
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
    changeBtn: {
      minHeight: 44,
      minWidth: 72,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
    },
    changeBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgTertiary,
      letterSpacing: 0,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.fgPrimary,
      backgroundColor: colors.bgSurface,
    },
    error: {
      fontSize: 13,
      color: colors.gradeAgain,
      lineHeight: 18,
    },
  });
}
