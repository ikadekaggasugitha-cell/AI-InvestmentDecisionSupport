import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  // A config file is evaluated before Vite loads .env files into import.meta.env,
  // and process.env does not get them either. Without this the proxy target falls
  // back to port 8000 and every API call fails with ECONNREFUSED, which looks
  // like a dead backend rather than a config value that never arrived.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      figmaAssetResolver(),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        // Alias @ to the src directory
        '@': path.resolve(__dirname, './src'),
      },
    },

    // The session cookie is what authenticates every request now, and cookies
    // behave differently across origins. Proxying /api through the dev server
    // makes the API same-origin in development, which fixes three things at once:
    // a deep link like /login survives a refresh, SameSite=Lax stops withholding
    // the cookie, and the WebSocket handshake carries it without a ticket.
    //
    // Without this, /login on a hard refresh returns the Vite 404 page and the
    // cookie has to be issued as SameSite=None to work across origins, which
    // browsers refuse on plain http.
    server: {
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
          // The WebSocket lives under the same prefix, so it needs the upgrade.
          ws: true,
        },
      },
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
