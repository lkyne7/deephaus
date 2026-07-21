import {
  MAX_IMAGE_DISPLAY_WIDTH,
  MIN_IMAGE_DISPLAY_WIDTH,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
} from "@deephaus/shared";
import { mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView } from "@tiptap/pm/view";

export {
  MAX_IMAGE_DISPLAY_WIDTH,
  MIN_IMAGE_DISPLAY_WIDTH,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
};

export type ResizableImageAttributes = {
  src: string;
  alt?: string | null;
  title?: string | null;
  displayWidth: number;
  aspectRatio?: number | null;
};

export type ResizableImageAction = "occlusion" | "crop" | "download";

export type ResizableImageOptions = ImageOptions & {
  imageActions: ResizableImageAction[];
};

function imageStyle(displayWidth: unknown, aspectRatio: unknown): string {
  const width = clampImageDisplayWidth(displayWidth);
  const ratio = normalizeImageAspectRatio(aspectRatio);
  return [
    `width: ${width}%`,
    "max-width: 100%",
    "height: auto",
    ratio == null ? null : `aspect-ratio: ${ratio}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function serializedImageAttributes(attributes: Record<string, unknown>): Record<string, string> {
  const displayWidth = clampImageDisplayWidth(attributes.displayWidth);
  const aspectRatio = normalizeImageAspectRatio(attributes.aspectRatio);
  return {
    "data-display-width": String(displayWidth),
    ...(aspectRatio == null ? {} : { "data-aspect-ratio": String(aspectRatio) }),
    style: imageStyle(displayWidth, aspectRatio),
  };
}

function updateImageElement(image: HTMLImageElement, node: ProseMirrorNode): void {
  const src = String(node.attrs.src ?? "");
  const alt = node.attrs.alt == null ? "" : String(node.attrs.alt);
  const title = node.attrs.title == null ? "" : String(node.attrs.title);

  if (image.getAttribute("src") !== src) image.setAttribute("src", src);
  image.alt = alt;
  if (title) image.title = title;
  else image.removeAttribute("title");
}

function applyNodeViewSize(
  frame: HTMLElement,
  image: HTMLImageElement,
  node: ProseMirrorNode,
): void {
  const displayWidth = clampImageDisplayWidth(node.attrs.displayWidth);
  const aspectRatio = normalizeImageAspectRatio(node.attrs.aspectRatio);
  frame.style.width = `${displayWidth}%`;
  frame.style.maxWidth = "100%";
  image.style.width = "100%";
  image.style.maxWidth = "100%";
  image.style.height = "auto";
  image.style.aspectRatio = aspectRatio == null ? "" : String(aspectRatio);
  frame.dataset.displayWidth = String(displayWidth);
  if (aspectRatio == null) delete frame.dataset.aspectRatio;
  else frame.dataset.aspectRatio = String(aspectRatio);
}

function styleHandle(handle: HTMLButtonElement, side: "left" | "right"): void {
  handle.type = "button";
  handle.tabIndex = -1;
  handle.dataset.resizeHandle = side;
  handle.setAttribute("aria-label", `Resize image from ${side}`);
  Object.assign(handle.style, {
    position: "absolute",
    top: "50%",
    [side]: "-6px",
    width: "12px",
    height: "32px",
    padding: "0",
    border: "2px solid white",
    borderRadius: "6px",
    background: "#2563eb",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
    cursor: "ew-resize",
    transform: "translateY(-50%)",
    touchAction: "none",
    display: "none",
    zIndex: "2",
  });
}

function createActionButton(
  action: ResizableImageAction,
  label: string,
  iconClass: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.imageAction = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: "32px",
    minWidth: "32px",
    padding: action === "occlusion" ? "0 10px" : "0 8px",
    border: "0",
    borderRadius: "7px",
    background: "transparent",
    color: "#344054",
    font: "600 12px/1 system-ui, sans-serif",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });
  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  if (action === "occlusion") {
    const text = document.createElement("span");
    text.textContent = "Create image occlusion";
    button.append(text);
  }
  button.addEventListener("mouseenter", () => {
    button.style.background = "#f2f4f7";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
  });
  return button;
}

function createResizableImageNodeView({
  node: initialNode,
  view,
  getPos,
  editor,
}: NodeViewRendererProps, actions: ResizableImageAction[]): NodeView {
  let node = initialNode;
  let selected = false;
  let removeDragListeners: (() => void) | null = null;

  const dom = document.createElement("div");
  dom.className = "dh-resizable-image";
  dom.dataset.resizableImage = "";
  dom.style.width = "100%";
  dom.style.maxWidth = "100%";
  dom.style.lineHeight = "0";
  dom.style.userSelect = "none";

  const frame = document.createElement("div");
  frame.style.position = "relative";
  frame.style.display = "inline-block";
  frame.style.lineHeight = "0";
  frame.style.verticalAlign = "top";

  const image = document.createElement("img");
  image.draggable = false;
  image.style.display = "block";

  const leftHandle = document.createElement("button");
  const rightHandle = document.createElement("button");
  styleHandle(leftHandle, "left");
  styleHandle(rightHandle, "right");
  const toolbar = document.createElement("div");
  toolbar.dataset.imageActions = "";
  Object.assign(toolbar.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    display: "none",
    alignItems: "center",
    gap: "2px",
    padding: "4px",
    border: "1px solid #e4e7ec",
    borderRadius: "9px",
    background: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 3px 12px rgba(16, 24, 40, 0.18)",
    lineHeight: "1",
    zIndex: "3",
  });
  for (const action of actions) {
    const config = {
      occlusion: ["Create image occlusion", "ri-image-edit-line"],
      crop: ["Crop image", "ri-crop-line"],
      download: ["Download image", "ri-download-line"],
    } as const;
    const [label, icon] = config[action];
    const button = createActionButton(action, label, icon);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dom.dispatchEvent(
        new CustomEvent("deephaus:image-action", {
          bubbles: true,
          detail: {
            action,
            src: String(node.attrs.src ?? ""),
            pos: getPos(),
          },
        }),
      );
    });
    toolbar.append(button);
  }
  frame.append(image, leftHandle, rightHandle, toolbar);
  dom.append(frame);

  const updateSelectionUi = () => {
    const showHandles = selected && editor.isEditable;
    leftHandle.style.display = showHandles ? "block" : "none";
    rightHandle.style.display = showHandles ? "block" : "none";
    toolbar.style.display = showHandles && actions.length > 0 ? "inline-flex" : "none";
    frame.style.outline = showHandles ? "2px solid #2563eb" : "";
    frame.style.outlineOffset = showHandles ? "2px" : "";
  };

  const updateAttributes = (attributes: Record<string, unknown>) => {
    const position = getPos();
    if (!Number.isInteger(position)) return;
    view.dispatch(
      view.state.tr
        .setNodeMarkup(
          position,
          undefined,
          { ...node.attrs, ...attributes },
          node.marks,
        )
        .setMeta("resizableImage", true),
    );
  };

  const resetSize = (event: MouseEvent) => {
    if (!editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    updateAttributes({ displayWidth: 100 });
  };

  const beginResize = (side: "left" | "right", event: PointerEvent) => {
    if (!editor.isEditable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    removeDragListeners?.();
    const startX = event.clientX;
    const startWidth = clampImageDisplayWidth(node.attrs.displayWidth);
    const containerWidth = Math.max(dom.getBoundingClientRect().width, 1);
    const intrinsicRatio =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? normalizeImageAspectRatio(image.naturalWidth / image.naturalHeight)
        : null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const direction = side === "right" ? 1 : -1;
      const deltaPercent = ((moveEvent.clientX - startX) / containerWidth) * 100 * direction;
      const displayWidth = clampImageDisplayWidth(startWidth + deltaPercent);
      updateAttributes({
        displayWidth,
        ...(node.attrs.aspectRatio == null && intrinsicRatio != null
          ? { aspectRatio: intrinsicRatio }
          : {}),
      });
    };

    const finish = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      removeDragListeners = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    removeDragListeners = finish;
  };

  leftHandle.addEventListener("pointerdown", (event) => beginResize("left", event));
  rightHandle.addEventListener("pointerdown", (event) => beginResize("right", event));
  image.addEventListener("dblclick", resetSize);

  updateImageElement(image, node);
  applyNodeViewSize(frame, image, node);

  return {
    dom,
    selectNode() {
      selected = true;
      updateSelectionUi();
    },
    deselectNode() {
      selected = false;
      updateSelectionUi();
    },
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      node = updatedNode;
      updateImageElement(image, node);
      applyNodeViewSize(frame, image, node);
      updateSelectionUi();
      return true;
    },
    stopEvent(event) {
      return (
        event.target === leftHandle ||
        event.target === rightHandle ||
        toolbar.contains(event.target as Node) ||
        event.type === "dblclick"
      );
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      removeDragListeners?.();
      image.removeEventListener("dblclick", resetSize);
    },
  };
}

/**
 * Shared image node for card and source-document editors. Serialized output is
 * always responsive; resized images retain controlled percentage/ratio attrs.
 */
export const ResizableImage = Image.extend<ResizableImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      imageActions: ["crop", "download"],
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      displayWidth: {
        default: 100,
        parseHTML: (element) =>
          clampImageDisplayWidth(element.getAttribute("data-display-width")),
        rendered: false,
      },
      aspectRatio: {
        default: null,
        parseHTML: (element) =>
          normalizeImageAspectRatio(element.getAttribute("data-aspect-ratio")),
        rendered: false,
      },
    };
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        serializedImageAttributes(node.attrs),
      ),
    ];
  },

  addNodeView() {
    const actions = this.options.imageActions;
    return (props) => createResizableImageNodeView(props, actions);
  },
});
