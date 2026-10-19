import { Node, mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";

export type AudioClipAttributes = {
  src: string;
  title?: string | null;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audioClip: {
      /** Insert an audio clip block at the selection. */
      setAudioClip: (attributes: AudioClipAttributes) => ReturnType;
    };
  }
}

export const DEFAULT_AUDIO_CLIP_TITLE = "Audio";

function updateAudioClipElements(
  title: HTMLElement,
  audio: HTMLAudioElement,
  node: ProseMirrorNode,
): void {
  const src = String(node.attrs.src ?? "");
  const label = String(node.attrs.title ?? "").trim() || DEFAULT_AUDIO_CLIP_TITLE;
  if (audio.getAttribute("src") !== src) audio.setAttribute("src", src);
  title.textContent = label;
}

function createAudioClipNodeView({ node: initialNode }: NodeViewRendererProps): NodeView {
  let node = initialNode;

  const dom = document.createElement("div");
  dom.className = "dh-audio-clip";
  dom.dataset.audioClip = "";
  dom.contentEditable = "false";
  Object.assign(dom.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    margin: "4px 0",
    border: "1px solid #e4e7ec",
    borderRadius: "10px",
    background: "#f9fafb",
    userSelect: "none",
  });

  const icon = document.createElement("i");
  icon.className = "ri-volume-up-line";
  icon.setAttribute("aria-hidden", "true");
  icon.style.color = "#475467";

  const title = document.createElement("span");
  title.className = "dh-audio-clip__title";
  Object.assign(title.style, {
    font: "500 13px/1.3 system-ui, sans-serif",
    color: "#344054",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "160px",
  });

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.style.flex = "1";
  audio.style.minWidth = "0";
  audio.style.height = "32px";
  // Keep clicks on the native controls from moving the editor selection.
  audio.addEventListener("mousedown", (event) => event.stopPropagation());

  updateAudioClipElements(title, audio, node);
  dom.append(icon, title, audio);

  return {
    dom,
    update(updated) {
      if (updated.type !== node.type) return false;
      node = updated;
      updateAudioClipElements(title, audio, node);
      return true;
    },
    selectNode() {
      dom.style.outline = "2px solid #7f56d9";
      dom.style.outlineOffset = "2px";
    },
    deselectNode() {
      dom.style.outline = "";
      dom.style.outlineOffset = "";
    },
    stopEvent(event) {
      // Let the native player handle its own pointer and keyboard events.
      return event.target === audio;
    },
    ignoreMutation() {
      return true;
    },
  };
}

/**
 * An audio clip on a card: a recording, an uploaded file or generated speech.
 * Stored in card text as `<audio src="…" title="…"></audio>`; Anki import and
 * export translate it to `[sound:file]`.
 */
export const AudioClip = Node.create({
  name: "audioClip",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute("src"),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
      },
    };
  },

  parseHTML() {
    return [{ tag: "audio[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "audio",
      mergeAttributes({ controls: "controls", preload: "metadata" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setAudioClip:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  addNodeView() {
    return (props) => createAudioClipNodeView(props);
  },
});
