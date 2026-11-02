const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const User = require('./models/User');
const { getLisSessionUserId } = require('./lib/lisSessionCookie');
const { createUploadSessionGate } = require('./lib/uploadSessionGate');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';
const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

// Apache mod_proxy อยู่หน้าเซิร์ฟเวอร์นี้เสมอ (.htaccess proxy /api/* → localhost:3001) และเติม
// X-Forwarded-For มาให้ ถ้าไม่ตั้ง trust proxy, req.ip จะเป็น loopback (::ffff:127.0.0.1) เสมอ
// ไม่ว่าใครยิงมาจากไหนก็ตาม ทำให้ log/rate-limit ของ apiGuard เห็น IP ผิดสำหรับ external caller
// ทุกราย — 'loopback' เชื่อ X-Forwarded-For เฉพาะ hop ที่มาจาก 127.0.0.1/::1 เท่านั้น (ตัว proxy จริง)
app.set('trust proxy', 'loopback');

// Baseline response protections; no dependency or frontend flow change.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(cors(corsOrigins.length ? {
  origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)),
  credentials: true,
} : undefined));
// Capture the raw request bytes so routes/line.js can verify the LINE webhook
// signature (HMAC over the exact body LINE sent — re-serialized JSON won't match).
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Serve uploaded QC photos as static assets
const requireUploadSession = createUploadSessionGate({
  getSessionUserId: getLisSessionUserId,
  findUserById: (id) => User.findById(id).select('_id status').lean(),
});
app.use('/LIS/uploads', requireUploadSession);
app.use('/uploads', requireUploadSession);
app.use('/LIS/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function mountApi(path, router) {
  app.use(`/api${path}`, router);
  app.use(`/LIS/api${path}`, router);
}

// ป้องกัน API ที่ระบบภายนอกเรียก — ต้องอยู่ก่อน mountApi ทุกบรรทัด (แต่หลัง
// express.json เพราะบาง route อ่าน req.body) path ที่ไม่อยู่ใน
// server/lib/apiPolicy.js จะถูกปล่อยผ่านทันที = traffic ของหน้าเว็บไม่กระทบ
const { apiGuard } = require('./lib/apiGuard');
app.use(apiGuard);

// API Routes
mountApi('/samples', require('./routes/samples'));
mountApi('/auth', require('./routes/auth'));
mountApi('/profile', require('./routes/profile'));
mountApi('/physical-results', require('./routes/physicalResults'));
mountApi('/approvals', require('./routes/approvals'));
mountApi('/densities', require('./routes/densities'));
mountApi('/result-densities', require('./routes/result-densities'));
mountApi('/request-values', require('./routes/request-values'));
mountApi('/instrument-readings', require('./routes/instrument-readings'));
mountApi('/stock', require('./routes/stock'));
mountApi('/access-control', require('./routes/accessControl'));
mountApi('/api-keys', require('./routes/apiKeys')); // จัดการ API key (admin เท่านั้น)
mountApi('/petitions', require('./routes/petitions'));
mountApi('/production-integration', require('./routes/productionIntegration'));
mountApi('/lab-requests', require('./routes/labRequests'));
mountApi('/goods-receipts', require('./routes/goodsReceipts'));
mountApi('/sample-receipts', require('./routes/sampleReceipts'));
mountApi('/employees', require('./routes/employees'));
mountApi('/master-items', require('./routes/masterItems'));
mountApi('/master-item', require('./routes/masterItems'));
mountApi('/master-item-meta', require('./routes/masterItemMeta'));
mountApi('/simple-methods', require('./routes/simpleMethods'));
mountApi('/standard-times', require('./routes/standardTimes'));
mountApi('/simple-method-exclusions', require('./routes/simpleMethodExclusions'));
mountApi('/common-name-overrides', require('./routes/commonNameOverrides'));
mountApi('/item-groups', require('./routes/itemGroups'));
mountApi('/machines', require('./routes/machines'));
mountApi('/virtual-lab', require('./routes/virtualLab'));
mountApi('/methods', require('./routes/methods'));
mountApi('/parameters', require('./routes/parameters'));
mountApi('/qc-results', require('./routes/qcResults'));
mountApi('/coa-documents', require('./routes/coaDocuments'));
mountApi('/uploads', require('./routes/uploads'));
mountApi('/daily-checks', require('./routes/dailyChecks'));
mountApi('/equipment-checks', require('./routes/equipment-checks'));
mountApi('/chemical-requisitions', require('./routes/chemical-requisitions')); // เบิกสารเคมี (solvent) → เครื่อง
mountApi('/temphum', require('./routes/temphum'));
mountApi('/env-checks', require('./routes/envChecks'));
mountApi('/env-room-config', require('./routes/envRoomConfig'));
mountApi('/document-number-config', require('./routes/documentNumberConfigs'));
mountApi('/dashboard-layout', require('./routes/dashboardLayout'));
mountApi('/user-favorites', require('./routes/userFavorites')); // รายการโปรดบน sidebar ต่อ user
mountApi('/print', require('./routes/print'));
mountApi('/ai', require('./routes/ai'));
mountApi('/validation-ai', require('./routes/validationAi'));
mountApi('/line', require('./routes/line')); // LINE webhook + group registry
mountApi('/push', require('./routes/push')); // แจ้งเตือน PWA (Web Push) ต่อเครื่อง
mountApi('/dev', require('./routes/dev')); // dev-only helpers (gated by ALLOW_DEV_STATUS)

const healthHandler = (_req, res) => res.json({ status: 'ok' });
app.get('/api/health', healthHandler);
app.get('/LIS/api/health', healthHandler);

// GET /api/list — browsable page of every mounted API endpoint (read-only introspection).
// ?format=json returns the raw list instead. Rendered server-side because /LIS/api/* is
// always proxied to the backend, so this can't be a React route.
// Must register before the SPA fallback so /LIS/api/list isn't swallowed by /LIS/*.
const { extractRoutes } = require('./lib/listRoutes');
const { renderRoutesPage } = require('./lib/routesPage');
const listRoutesHandler = (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();
  const routes = extractRoutes(app);
  if (req.query.format === 'json') return res.json({ data: routes });
  res.type('html').send(renderRoutesPage(routes));
};
app.get('/api/list', listRoutesHandler);
app.get('/LIS/api/list', listRoutesHandler);

// Serve React build if dist folder exists
const fs = require('fs');
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use('/LIS', express.static(distPath));
  // SPA fallback: serve index.html for all /LIS routes (handles browser refresh)
  app.get(['/LIS/*'], (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

function loadAllModels() {
  const modelsDir = path.join(__dirname, 'models');
  for (const file of fs.readdirSync(modelsDir)) {
    // Only load model modules — skip co-located test files (*.test.js / *.spec.js).
    // Requiring a test file here runs describe()/test() outside any test runner,
    // throwing "describe is not defined" and crashing boot before app.listen().
    if (file.endsWith('.js') && !/\.(test|spec)\.js$/.test(file)) {
      require(path.join(modelsDir, file));
    }
  }
}

async function ensureCollections() {
  const names = Object.keys(mongoose.models);
  const existing = new Set(
    (await mongoose.connection.db.listCollections().toArray()).map(c => c.name)
  );
  for (const name of names) {
    const model = mongoose.models[name];
    if (!existing.has(model.collection.name)) {
      await model.createCollection();
      console.log(`📦 Created collection: ${model.collection.name}`);
    }
    await model.syncIndexes();
  }
}

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    loadAllModels();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
    ensureCollections().catch((err) => {
      console.error('❌ Collection initialization error:', err.message);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
