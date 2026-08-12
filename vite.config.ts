import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The base path must match the GitHub Pages repo name, since Pages serves the
// site from https://<user>.github.io/<repo>/.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/FRC-Subsystem-Generator/' : '/',
  plugins: [react()],
});
