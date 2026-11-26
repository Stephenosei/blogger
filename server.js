import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.APP_PORT) || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Block direct HTTP access to server internals, env files, and SQL migrations
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  const blockedExact = ['/server.js', '/package.json', '/package-lock.json', '/vercel.json', '/.env', '/.env.example'];
  if (
    blockedExact.includes(reqPath) ||
    reqPath.startsWith('/node_modules') ||
    reqPath.startsWith('/supabase') ||
    reqPath.startsWith('/.env') ||
    reqPath.startsWith('/api/public-config.js')
  ) {
    return res.status(404).send('Not found');
  }
  next();
});

// Expose ONLY public Supabase URL and anon key (never expose service_role key)
app.get('/api/public-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '';

  res.json({
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
  });
});

// Clean route aliases matching vercel.json
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get(['/admin/login', '/admin/login/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/story/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'story.html'));
});

app.get(['/stories', '/stories/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'stories.html'));
});

app.get(['/submit', '/submit/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'submit-story.html'));
});

app.use(express.static(__dirname, { extensions: ['html'] }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
