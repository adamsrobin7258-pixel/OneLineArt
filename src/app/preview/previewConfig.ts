/** Long edge of the in-app artwork preview (render resolution, independent of the processing resolution). */
export const PREVIEW_RENDER_EDGE = 2048;

/** Zoom factor from which the preview is re-rendered sharper (the path is reused, never recomputed). */
export const ZOOM_SHARPEN_SCALE = 1.5;
/** Long edge of that sharper preview (fits the canvas limits of iOS Safari). */
export const ZOOM_RENDER_EDGE = 4096;
