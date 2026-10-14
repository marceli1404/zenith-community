import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
// Local authoring server. Not part of the production build or deployment.
export default defineConfig({ plugins: [react(), tailwindcss()], resolve: { alias: { '@shared': resolve('src/shared'), '@web': resolve('web') } }, server: { port: 5175, host: '127.0.0.1' } });
