import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const localApiPlugin = () => ({
  name: 'local-serverless-api-middleware',
  configureServer(server) {
    const mountEndpoint = (routePath, modulePath) => {
      server.middlewares.use(routePath, async (req, res) => {
        try {
          const env = loadEnv(server.config.mode, process.cwd(), '');
          for (const [k, v] of Object.entries(env)) {
            if (v && !process.env[k]) {
              process.env[k] = v;
            }
          }

          let rawBody = '';
          await new Promise((resolve) => {
            req.on('data', (chunk) => { rawBody += chunk; });
            req.on('end', resolve);
          });

          req.body = rawBody ? JSON.parse(rawBody) : {};

          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
            return res;
          };

          const { default: handler } = await import(modulePath);
          await handler(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ fallback: true, reason: 'middleware_error', message: err.message }));
        }
      });
    };

    mountEndpoint('/api/ai-coach', './api/ai-coach.js');
    mountEndpoint('/api/google-fit-token', './api/google-fit-token.js');
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    proxy: {
      '/api/bom': {
        target: 'http://reg.bom.gov.au',
        changeOrigin: true,
        rewrite: () => '/fwo/IDW60901/IDW60901.94610.json',
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500, // Firebase SDK is large
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.js',
    globals: true,
    testTimeout: 15000,
  },
})
