import { defineConfig } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'

// Board generation tests run ~3x slower on CI runners than locally.
export default defineConfig({ plugins: [tailwindcss()], test: { testTimeout: 20_000 } })
