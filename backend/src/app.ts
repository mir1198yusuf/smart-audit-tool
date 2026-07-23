import cors from 'cors';
import express, { Application } from 'express';
import auditEntriesRoutes from './routes/auditEntries.routes.js';

const app: Application = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`[backend:http] ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server running fine' });
});

app.use('/api/audit-entries', auditEntriesRoutes);

export default app;
