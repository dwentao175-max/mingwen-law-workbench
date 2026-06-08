import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repoName ? `/${repoName}/` : './',
  plugins: [react()]
});
