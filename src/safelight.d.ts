// The slice of Safelight's extension API this extension touches, mirrored from
// the app's src/extensions/types.ts, src/extensions/ui-kit.tsx and the
// develop store. Extensions are standalone bundles, so the host's source is
// not on the type path; React types come from @types/react (dev only).

import type { ComponentType, CSSProperties, ReactNode } from "react";

export interface StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState(): T;
  setState(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: (state: T, prev: T) => void): () => void;
}

export type StateCreator<T> = (
  set: (partial: Partial<T> | ((s: T) => Partial<T>)) => void,
  get: () => T,
) => T;

/** Core develop params: opaque here, only ever handed back to core. */
export type DevelopParams = Record<string, unknown> & { readonly __develop: unique symbol };

export interface DevelopStoreState {
  photoId: string | null;
  params: DevelopParams;
  previewParams: DevelopParams | null;
  /** Extension stage params by qualified key. Values come back from sidecar
   *  JSON, so they are read defensively (params.ts). */
  paramBag: Record<string, unknown>;
  /** Render-only override of `paramBag` while a preset is hovered; null
   *  otherwise. The canvas draws this one when it is set. */
  previewParamBag: Record<string, unknown> | null;
  /** Recomputed by core after every settled render. */
  histogram: object | null;
  /** "none" unless a core canvas tool (mask, retouch, HSL picker) is active. */
  activeTool: string;
  cropping: boolean;
  /** Per-panel preview-off (view-only, momentary), keyed by panel id: the
   *  live render leaves a bypassed panel's contribution out, and the stored
   *  edit is untouched. */
  bypassedPanels: Record<string, boolean>;
  setDynParams(patch: Record<string, unknown>): void;
  commitEdit(label: string): Promise<void>;
}

export interface CatalogPhotoLike {
  id: string;
  exif: { colorTemperature?: number };
}

export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DevelopOverlayState {
  /** Where the displayed pixels sit; the visible window when zoomed. */
  rect: OverlayRect | null;
  /** Where the full image sits; extends past the frame when zoomed. Null until
   *  the first layout. */
  imageRect: OverlayRect | null;
  nonce: number;
}

export type GlslType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "sampler2D";

export interface UniformDeclaration {
  key: string;
  glslType: GlslType;
  default: number | number[] | boolean;
  range?: { min: number; max: number; step?: number };
  label?: string;
}

export type ProcessingPhase =
  | "geometry"
  | "decode"
  | "noise-reduction"
  | "scene-linear"
  | "tone-map"
  | "display-adjust"
  | "effects"
  | "output-encode";

/** The values a processing stage receives and hands back. */
export interface StageSpace {
  /** "linear": proportional to light. "perceptual": the sRGB curve extended both
   *  ways (sign kept, no ceiling), so display-style maths still sees what lies
   *  beyond [0, 1]. */
  encoding: "linear" | "perceptual";
  /** Default "rec709", the core's working primaries. */
  primaries?: "rec709" | "rec2020";
}

export interface ProcessingStageContribution {
  id: string;
  name: string;
  phase: ProcessingPhase;
  priority?: number;
  glsl: string;
  helpers?: string;
  uniforms: UniformDeclaration[];
  presetScope?: "global" | "per-image";
  /** Opt into full-information values. Omitted, a display-domain stage is handed
   *  `c` clipped to [0, 1] on process version 2, the clip written ahead of its
   *  block and outside its own gate. Hosts before process versions ignore it. */
  space?: StageSpace;
}

export interface PanelContribution {
  id: string;
  title: string;
  component: ComponentType;
  defaultDock?: {
    module: "library" | "develop";
    direction: "left" | "right" | "bottom";
    order?: number;
    width?: number;
    height?: number;
  };
  onReset?: () => void;
}

export interface SlotContribution {
  id: string;
  slot: "develop-canvas-overlay" | "develop-toolbar" | "library-toolbar" | "library-subbar";
  component: ComponentType;
  order?: number;
}

export interface SliderProps {
  label: string;
  value: number;
  onChange(value: number): void;
  onCommit?(): void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  hideValue?: boolean;
  compact?: boolean;
  trackBackground?: string;
}

export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  active?: boolean;
  full?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?(): void;
  children?: ReactNode;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange(value: string): void;
  options?: SelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  title?: string;
}

export interface SegmentedControlProps {
  value: string;
  onChange(value: string): void;
  options: SegmentedOption[];
  size?: "sm" | "md";
}

export interface SectionProps {
  title: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

export interface RowProps {
  children?: ReactNode;
  gap?: number;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  style?: CSSProperties;
}

export interface StackProps {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  ariaLabel?: string;
}

export type SettingsField = {
  key: string;
  label: string;
  hint?: string;
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;
};

export interface SettingsContribution {
  title?: string;
  fields: SettingsField[];
  keywords?: string[];
}

export type ExportProcessorField =
  | { key: string; label: string; hint?: string; type: "number"; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; hint?: string; type: "select"; default: string; options: { value: string; label: string }[] };

/** What a processor is told about the export it runs in. */
export interface ExportProcessorContext {
  /** The export's long-edge setting in pixels, null for original size. It caps
   *  the source before the crop, so a cropped photo is delivered smaller than
   *  this. Rendering the photo again through renderPhotos with the same
   *  longEdge gets the delivered file's pixel grid to within a pixel. */
  longEdge: number | null;
}

export interface ExportProcessorContribution {
  id: string;
  label: string;
  settings?: ExportProcessorField[];
  process(
    blob: Blob,
    photo: CatalogPhotoLike,
    settings: Record<string, unknown>,
    context: ExportProcessorContext,
  ): Promise<Blob>;
}

export interface EditSnapshotLike {
  params: DevelopParams;
  paramBag?: Record<string, unknown>;
}

export interface EditStateLike {
  photoId: string;
  stack: EditSnapshotLike[];
  currentIndex: number;
}

export interface RenderedPhotoLike {
  blob: Blob | null;
  width: number;
  height: number;
}

export interface ExportSettingsPatch {
  format?: "image/jpeg" | "image/png" | "image/webp" | "image/tiff";
  quality?: number;
  longEdge?: number | null;
  colorSpace?: "srgb" | "display-p3" | "adobe-rgb" | "prophoto-rgb";
  sharpenAmount?: number;
  includeMetadata?: boolean;
}

export interface UiKit {
  Button: ComponentType<ButtonProps>;
  Select: ComponentType<SelectProps>;
  SegmentedControl: ComponentType<SegmentedControlProps>;
  Section: ComponentType<SectionProps>;
  Row: ComponentType<RowProps>;
  Stack: ComponentType<StackProps>;
  Toggle: ComponentType<ToggleProps>;
  tokens: Readonly<Record<string, string>>;
}

export interface SafelightAPI {
  version: 1;
  extensionId: string;
  react: typeof import("react");
  registerProcessingStage(c: ProcessingStageContribution): void;
  unregisterProcessingStage(id: string): void;
  registerPanel(c: PanelContribution): void;
  registerSlot(c: SlotContribution): void;
  unregisterSlot(id: string): void;
  registerSettings(c: SettingsContribution): void;
  registerExportProcessor(c: ExportProcessorContribution): void;
  settings: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    onChange(cb: (key: string, value: unknown) => void): () => void;
  };
  components: {
    Slider: ComponentType<SliderProps>;
  };
  ui: UiKit;
  stores: {
    create<T>(init: StateCreator<T>): StoreApi<T>;
    useDevelopStore: StoreApi<DevelopStoreState>;
  };
  cursors: {
    resolve(token: string): string;
  };
  catalog: {
    getEditState(photoId: string): Promise<EditStateLike | null>;
  };
  export: {
    renderPhotos(
      photos: CatalogPhotoLike[],
      settings?: ExportSettingsPatch,
      onProgress?: (p: { done: number; total: number; filename: string }) => void,
      options?: { paramBag?: Record<string, unknown> },
    ): Promise<RenderedPhotoLike[]>;
  };
  develop: {
    useDevelopOverlay(): DevelopOverlayState;
    captureFrame(
      params: DevelopParams,
      options?: { asShown?: boolean; paramBag?: Record<string, unknown> },
    ): Promise<ImageBitmap>;
  };
}

export interface ExtensionModule {
  activate(api: SafelightAPI): void;
  deactivate?(): void;
}
