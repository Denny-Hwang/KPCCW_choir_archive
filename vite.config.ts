import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages는 https://<user>.github.io/<repo>/ 로 서빙되므로 base에 저장소명이 필요하다 (§13.1).
// 커스텀 도메인을 붙이면 BASE_PATH=/ 로 빌드한다.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/KPCCW_choir_archive/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
