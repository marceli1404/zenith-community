/// <reference types="vite/client" />

/**
 * The year the bundle was built, substituted by Vite (see vite.config.ts).
 * Used for the footer copyright: a constant, so the prerendered HTML and the
 * client's first render always agree and hydration keeps the painted page.
 */
declare const __BUILD_YEAR__: string;
