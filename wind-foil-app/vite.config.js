import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const localAiCoachPlugin = () => ({
  name: 'local-ai-coach-middleware',
  configureServer(server) {
    server.middlewares.use('/api/ai-coach', async (req, res) => {
      try {
        const env = loadEnv(server.config.mode, process.cwd(), '');
        if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
          process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
        }
        if (env.VITE_GEMINI_API_KEY && !process.env.VITE_GEMINI_API_KEY) {
          process.env.VITE_GEMINI_API_KEY = env.VITE_GEMINI_API_KEY;
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

        const { default: aiCoachHandler } = await import('./api/ai-coach.js');
        await aiCoachHandler(req, res);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ fallback: true, reason: 'middleware_error', message: err.message }));
      }
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localAiCoachPlugin()],
  server: {
    host: true, // Listen on all local IP addresses
    allowedHosts: true, // Allow all hosts to prevent "Host not allowed" errors
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
