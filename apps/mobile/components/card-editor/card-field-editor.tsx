import { useAccessibilityAnnouncement } from "@/hooks/use-accessibility-announcement";
import { cardAudioSizeError } from "@deephaus/shared";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { AudioRecorderModal } from "@/components/card-editor/audio-recorder-modal";
import {
  useEditorToolbar,
  type ToolbarField,
} from "@/components/card-editor/editor-toolbar-context";
import { GenerateSpeechModal } from "@/components/card-editor/generate-speech-modal";
import RichField from "@/components/card-editor/rich-field-dom";
import { CARD_FIELD_TYPE, richFieldTheme } from "@/components/card-editor/rich-field-theme";
import {
  EMPTY_RICH_FIELD_STATE,
  type CardFieldRole,
  type RichFieldHandle,
  type RichFieldState,
} from "@/components/card-editor/rich-field-types";
import { RichCardContent } from "@/components/rich-card-content";
import { api } from "@/lib/api";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { typedAudioBlob, typedImageUpload } from "@/lib/upload-media";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cardId: string;
  placeholder?: string;
  disabled?: boolean;
  allowCloze?: boolean;
  /** The face of the card, or the quieter note under the answer. */
  role?: CardFieldRole;
};

/**
 * One part of a card, edited where study shows it: no box, no label, the same
 * type. It stores markdown. Formatting and media live in the keyboard toolbar
 * (see EditorKeyboardToolbar), which acts on whichever field is focused.
 */
export function CardFieldEditor({
  label,
  value,
  onChange,
  cardId,
  placeholder,
  disabled,
  allowCloze = false,
  role = "face",
}: Props) {
  const { colors, colorScheme } = useTheme();
  const { fontScale } = useWindowDimensions();
  const cardFont = useCardFont();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toolbar = useEditorToolbar();
  const fieldId = `${cardId}:${label.toLowerCase()}`;
  const handleRef = useRef<RichFieldHandle>(null);
  const frameRef = useRef<View>(null);
  const stateRef = useRef<RichFieldState>(EMPTY_RICH_FIELD_STATE);
  // The web view spends a couple of seconds starting its process before it can
  // paint; until it reports its first state the field shows the text natively.
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recorderVisible, setRecorderVisible] = useState(false);
  const [speechVisible, setSpeechVisible] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useAccessibilityAnnouncement(uploadError);

  const theme = useMemo(
    () => richFieldTheme(colors, colorScheme, fontScale, role, cardFont),
    [colors, colorScheme, fontScale, role, cardFont],
  );

  async function uploadImage() {
    setUploadError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const raw = await (await fetch(asset.uri)).blob();
      const { blob, filename, baseName } = typedImageUpload(raw, asset);
      const { url } = await api.uploadCardMedia(cardId, blob, filename);
      handleRef.current?.insertImage(url, baseName);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  /** Upload a local audio file and insert it at the cursor as a clip. */
  async function addAudioFromUri(uri: string, filename: string, title: string, mimeType?: string | null) {
    setUploading(true);
    setUploadError(null);
    try {
      const blob = typedAudioBlob(await (await fetch(uri)).blob(), filename, mimeType);
      // Fail before uploading: an oversized body is rejected by the platform with no JSON error.
      const sizeError = cardAudioSizeError(blob.size);
      if (sizeError) throw new Error(sizeError);
      const { url } = await api.uploadCardMedia(cardId, blob, filename);
      handleRef.current?.insertAudio(url, title);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
      throw error;
    } finally {
      setUploading(false);
    }
  }

  async function pickAudioFile() {
    setUploadError(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    const title = asset.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Audio";
    await addAudioFromUri(asset.uri, asset.name, title, asset.mimeType).catch(() => undefined);
  }

  function addAudio() {
    Alert.alert("Add audio", `Add a clip to the ${label.toLowerCase()}.`, [
      { text: "Record", onPress: () => setRecorderVisible(true) },
      { text: "Choose file", onPress: () => void pickAudioFile() },
      { text: "Generate speech", onPress: () => setSpeechVisible(true) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const busy = Boolean(disabled || uploading);
  const fieldType = CARD_FIELD_TYPE[role];
  const minHeight = FIELD_PADDING_Y * 2 + fieldType.lineHeight * fontScale;
  const nativeType = {
    ...cardFontStyle(cardFont),
    fontSize: fieldType.fontSize,
    lineHeight: fieldType.lineHeight,
    textAlign: "center" as const,
    color: role === "note" ? colors.fgTertiary : colors.fgPrimary,
  };
  const descriptor: ToolbarField = {
    id: fieldId,
    label,
    clozeEnabled: allowCloze,
    disabled: busy,
    handle: handleRef,
    addImage: () => void uploadImage(),
    addAudio,
  };
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  function handleState(next: RichFieldState) {
    setReady(true);
    stateRef.current = next;
    toolbar.reportState(descriptorRef.current, next);
    if (next.focused && next.caret) toolbar.ensureCaretVisible(frameRef.current, next.caret);
  }

  // The keyboard animates in after focus; re-check the caret once it has settled.
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const current = stateRef.current;
      if (current.focused && current.caret) {
        toolbar.ensureCaretVisible(frameRef.current, current.caret);
      }
    });
    return () => subscription.remove();
  }, [toolbar]);

  return (
    <View style={styles.field}>
      <AudioRecorderModal
        visible={recorderVisible}
        onClose={() => setRecorderVisible(false)}
        onRecorded={(uri) => addAudioFromUri(uri, `recording-${Date.now()}.m4a`, "Recording")}
      />
      <GenerateSpeechModal
        visible={speechVisible}
        onClose={() => setSpeechVisible(false)}
        cardId={cardId}
        fieldLabel={label}
        initialText={value}
        onGenerated={({ url, title }) => handleRef.current?.insertAudio(url, title)}
      />

      <View
        ref={frameRef}
        collapsable={false}
        testID={`card-field-${label.toLowerCase()}`}
        accessibilityLabel={label}
        style={[{ minHeight }, disabled && styles.frameDisabled]}
      >
        {ready ? null : (
          <View style={styles.placeholder} pointerEvents="none">
            {value.trim() ? (
              <RichCardContent content={value} textStyle={nativeType} />
            ) : (
              <Text style={[nativeType, styles.placeholderText]}>{placeholder ?? ""}</Text>
            )}
          </View>
        )}
        <RichField
          ref={handleRef}
          label={label}
          value={value}
          placeholder={placeholder ?? ""}
          clozeEnabled={allowCloze}
          disabled={busy}
          theme={theme}
          onChange={(markdown) => onChangeRef.current(markdown)}
          onState={handleState}
          onLatexTap={(detail) =>
            toolbar.openPrompt({
              kind: "latex",
              fieldId,
              formula: detail.formula,
              display: detail.display,
              pos: detail.pos,
            })
          }
          dom={{
            matchContents: true,
            scrollEnabled: false,
            bounces: false,
            hideKeyboardAccessoryView: true,
            contentInsetAdjustmentBehavior: "never",
            automaticallyAdjustContentInsets: false,
            showsVerticalScrollIndicator: false,
            showsHorizontalScrollIndicator: false,
            containerStyle: [ready ? styles.webview : styles.webviewLoading, { minHeight }],
          }}
        />
      </View>

      {uploading ? <ActivityIndicator color={colors.accent} accessibilityLabel="Uploading" /> : null}
      {uploadError ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {uploadError}
        </Text>
      ) : null}
    </View>
  );
}

/** `.dh-field` padding in rich-field.css. */
const FIELD_PADDING_Y = 8;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      gap: 8,
    },
    frameDisabled: {
      opacity: 0.6,
    },
    webview: {
      width: "100%",
    },
    // Loads behind the native placeholder at the frame's width so its first
    // size report is right, then moves into the flow.
    webviewLoading: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      opacity: 0,
    },
    placeholder: {
      paddingVertical: FIELD_PADDING_Y,
    },
    placeholderText: {
      color: colors.fgPlaceholder,
    },
    errorText: {
      fontSize: 12,
      textAlign: "center",
      color: colors.fgError,
    },
  });
}
