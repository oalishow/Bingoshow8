import path from 'path';
import { defineConfig, loadEnv } from 'vite';


import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const buildTimestamp = Date.now();
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        cors: true,
        strictPort: true,
        hmr: process.env.DISABLE_HMR !== 'true'
      },
      preview: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        cors: true,
        strictPort: true
      },
      plugins: [
        VitePWA({
          registerType: 'autoUpdate',
          devOptions: {
            enabled: false,
          },
          workbox: {
            cleanupOutdatedCaches: true,
            navigateFallbackDenylist: [/attendee\.html/, /attendee/],
            globPatterns: ['**/*.{js,css,ico,png,svg,json}', 'index.html'],
            globIgnores: ['**/attendee.html'],
            runtimeCaching: [
              {
                urlPattern: /attendee\.html/i,
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'attendee-html-cache',
                  networkTimeoutSeconds: 3,
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 7
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              {
                urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'google-fonts-cache',
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 365
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              {
                urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'gstatic-fonts-cache',
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 365
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              {
                urlPattern: /^https:\/\/cdn\.tailwindcss\.com\/.*/i,
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'tailwindcss-cache',
                  expiration: {
                    maxEntries: 5,
                    maxAgeSeconds: 60 * 60 * 24 * 30
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              },
              {
                urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'jsdelivr-cache',
                  expiration: {
                    maxEntries: 10,
                    maxAgeSeconds: 60 * 60 * 24 * 30
                  },
                  cacheableResponse: {
                    statuses: [0, 200]
                  }
                }
              }
            ]
          },
          includeAssets: ['favicon.ico', 'favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-512x512-maskable.png', 'icon.svg'],
          manifest: {
            name: 'Bingo Show',
            short_name: 'Bingo Show',
            description: 'Aplicativo de Bingo Show',
            theme_color: '#4f46e5',
            background_color: '#1e1b4b',
            display: 'standalone',
            start_url: '/',
            icons: [
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable'
              },
              {
                src: 'pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
              },
              {
                src: 'pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
              },
              {
                src: 'favicon.ico',
                sizes: '48x48 64x64 128x128 256x256',
                type: 'image/x-icon'
              },
              {
                src: 'favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml'
              }
            ],
            shortcuts: [
              {
                name: 'Iniciar Bingo',
                short_name: 'Bingo',
                description: 'Abrir painel de Bingo',
                url: '/',
                icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
              }
            ]
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            attendee: path.resolve(__dirname, 'attendee.html')
          },
          output: {
            entryFileNames: `assets/[name]-[hash]-${buildTimestamp}.js`,
            chunkFileNames: `assets/[name]-[hash]-${buildTimestamp}.js`,
            assetFileNames: `assets/[name]-[hash]-${buildTimestamp}.[ext]`,
          }
        }
      }
    };
});
