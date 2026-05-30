import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(projectRoot, 'data');
const dbFile = join(dataDir, 'applypilot.sqlite');
const legacyStateFile = join(dataDir, 'app-state.json');
const staticRoot = join(projectRoot, 'dist');
const { Pool } = pg;
const defaultGmailQuery = 'from:(jobalerts-noreply@linkedin.com) newer_than:30d';
const legacyDefaultGmailQueries = new Set([
  'from:linkedin.com newer_than:2d',
  'from:jobalerts-noreply@linkedin.com newer_than:2d',
]);
const gmailJobAlertFallbackQueries = [
  defaultGmailQuery,
  'from:jobalerts-noreply@linkedin.com newer_than:30d',
  'from:(jobalerts-noreply@linkedin.com)',
  'from:"jobalerts-noreply@linkedin.com"',
];

await mkdir(dataDir, { recursive: true });

const storage = process.env.DATABASE_URL ? createPostgresStorage() : createSqliteStorage();
await storage.initialize();
await migrateGmailQueryDefault();
await migrateLegacyJsonState();

function createSqliteStorage() {
  const db = new DatabaseSync(dbFile);

  return {
    type: 'sqlite',
    label: `SQLite database: ${dbFile}`,
    initialize() {
      db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT,
      applied_at TEXT,
      interview_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);
    CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at);
    CREATE INDEX IF NOT EXISTS idx_applications_interview_at ON applications(interview_at);
    CREATE INDEX IF NOT EXISTS idx_profile_versions_created_at ON profile_versions(created_at);
  `);
    },
    countApplications() {
      return Number(db.prepare('SELECT COUNT(*) AS count FROM applications').get().count ?? 0);
    },
    getSetting(key) {
      return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
    },
    setSetting(key, value) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    },
    listApplications() {
      return db
        .prepare('SELECT data FROM applications ORDER BY score DESC, created_at DESC')
        .all()
        .map((row) => JSON.parse(row.data));
    },
    replaceApplications(state) {
      db.exec('BEGIN');

      try {
        db.prepare('DELETE FROM applications').run();

        for (const application of state.applications) {
          db.prepare(
            `INSERT INTO applications
              (id, data, status, score, created_at, applied_at, interview_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            application.id,
            JSON.stringify(application),
            String(application.status ?? 'Saved'),
            Number(application.score ?? 0),
            application.createdAt ?? null,
            application.appliedAt ?? null,
            application.interviewAt ?? null,
            state.updatedAt,
          );
        }

        this.setSetting('dailyTarget', String(state.dailyTarget));
        this.setSetting('currentProfile', state.profile);
        this.setSetting('updatedAt', state.updatedAt);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listProfileVersions() {
      return db
        .prepare('SELECT id, name, content, source, created_at AS createdAt FROM profile_versions ORDER BY created_at DESC')
        .all();
    },
    insertProfileVersion(version) {
      db.prepare('INSERT INTO profile_versions (id, name, content, source, created_at) VALUES (?, ?, ?, ?, ?)').run(
        version.id,
        version.name,
        version.content,
        version.source,
        version.createdAt,
      );
    },
    getProfileVersion(profileId) {
      return db.prepare('SELECT id, content FROM profile_versions WHERE id = ?').get(String(profileId)) ?? null;
    },
    deleteProfileVersion(profileId) {
      db.prepare('DELETE FROM profile_versions WHERE id = ?').run(String(profileId));
    },
  };
}

function createPostgresStorage() {
  const connectionString = process.env.DATABASE_URL;
  const databaseUrl = new URL(connectionString);
  const localDatabase = ['localhost', '127.0.0.1'].includes(databaseUrl.hostname);
  const sslDisabled = process.env.POSTGRES_SSL === 'false';
  const sslRequired = !localDatabase && !sslDisabled;
  const pool = new Pool({
    connectionString,
    ssl: sslRequired ? { rejectUnauthorized: false } : false,
  });

  async function setSettingWithClient(client, key, value) {
    await client.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value)],
    );
  }

  return {
    type: 'postgres',
    label: 'Postgres database: DATABASE_URL',
    async initialize() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS applications (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          status TEXT NOT NULL,
          score INTEGER NOT NULL,
          created_at TEXT,
          applied_at TEXT,
          interview_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profile_versions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
        CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);
        CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at);
        CREATE INDEX IF NOT EXISTS idx_applications_interview_at ON applications(interview_at);
        CREATE INDEX IF NOT EXISTS idx_profile_versions_created_at ON profile_versions(created_at);
      `);
    },
    async countApplications() {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM applications');
      return Number(result.rows[0]?.count ?? 0);
    },
    async getSetting(key) {
      const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
      return result.rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await pool.query(
        `INSERT INTO settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value)],
      );
    },
    async listApplications() {
      const result = await pool.query('SELECT data FROM applications ORDER BY score DESC, created_at DESC');
      return result.rows.map((row) => JSON.parse(row.data));
    },
    async replaceApplications(state) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM applications');

        for (const application of state.applications) {
          await client.query(
            `INSERT INTO applications
              (id, data, status, score, created_at, applied_at, interview_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              application.id,
              JSON.stringify(application),
              String(application.status ?? 'Saved'),
              Number(application.score ?? 0),
              application.createdAt ?? null,
              application.appliedAt ?? null,
              application.interviewAt ?? null,
              state.updatedAt,
            ],
          );
        }

        await setSettingWithClient(client, 'dailyTarget', String(state.dailyTarget));
        await setSettingWithClient(client, 'currentProfile', state.profile);
        await setSettingWithClient(client, 'updatedAt', state.updatedAt);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async listProfileVersions() {
      const result = await pool.query(
        'SELECT id, name, content, source, created_at AS "createdAt" FROM profile_versions ORDER BY created_at DESC',
      );
      return result.rows;
    },
    async insertProfileVersion(version) {
      await pool.query('INSERT INTO profile_versions (id, name, content, source, created_at) VALUES ($1, $2, $3, $4, $5)', [
        version.id,
        version.name,
        version.content,
        version.source,
        version.createdAt,
      ]);
    },
    async getProfileVersion(profileId) {
      const result = await pool.query('SELECT id, content FROM profile_versions WHERE id = $1', [String(profileId)]);
      return result.rows[0] ?? null;
    },
    async deleteProfileVersion(profileId) {
      await pool.query('DELETE FROM profile_versions WHERE id = $1', [String(profileId)]);
    },
  };
}

async function migrateLegacyJsonState() {
  const existingApplications = await storage.countApplications();

  if (existingApplications > 0 || (await getSetting('legacyMigrated')) === 'true') {
    return;
  }

  try {
    const raw = await readFile(legacyStateFile, 'utf8');
    await writeAppState(JSON.parse(raw));
    await setSetting('legacyMigrated', 'true');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    await setSetting('legacyMigrated', 'true');
  }
}

async function migrateGmailQueryDefault() {
  const currentQuery = await storage.getSetting('gmailQuery');

  if (legacyDefaultGmailQueries.has(currentQuery)) {
    await storage.setSetting('gmailQuery', defaultGmailQuery);
  }
}

function readJson(request, maxBytes = 5_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;

      if (body.length > maxBytes) {
        request.destroy();
        reject(new Error('Request body is too large.'));
      }
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function sendUnauthorized(response) {
  response.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Basic realm="ApplyPilot"',
  });
  response.end(JSON.stringify({ error: 'Authentication required.' }));
}

function getSetting(key) {
  return storage.getSetting(key);
}

function setSetting(key, value) {
  return storage.setSetting(key, value);
}

function normalizeAppState(payload = {}) {
  const dailyTarget = Number(payload.dailyTarget);

  return {
    applications: Array.isArray(payload.applications) ? payload.applications : [],
    dailyTarget: Number.isFinite(dailyTarget) && dailyTarget > 0 ? dailyTarget : 10,
    profile: typeof payload.profile === 'string' ? payload.profile : '',
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
  };
}

async function readAppState() {
  const applications = await storage.listApplications();
  const dailyTarget = Number((await getSetting('dailyTarget')) ?? 10);
  const profile = (await getSetting('currentProfile')) ?? '';
  const profileVersions = await readProfileVersions();
  const updatedAt = await getSetting('updatedAt');
  const hasStoredState = Boolean(updatedAt) || applications.length > 0 || profileVersions.length > 0 || Boolean(profile);

  return {
    applications,
    dailyTarget: Number.isFinite(dailyTarget) && dailyTarget > 0 ? dailyTarget : 10,
    profile,
    activeProfileId: await getSetting('activeProfileId'),
    profileVersions,
    isStored: hasStoredState,
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}

async function writeAppState(payload) {
  const state = normalizeAppState({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  const applications = state.applications.map((application) => {
    const id = String(application.id ?? crypto.randomUUID());
    return { ...application, id };
  });

  await storage.replaceApplications({ ...state, applications });
  return readAppState();
}

function readProfileVersions() {
  return storage.listProfileVersions();
}

async function addProfileVersion(payload) {
  const content = String(payload.content ?? '').trim();
  const name = String(payload.name ?? '').trim() || `Profile ${new Date().toLocaleDateString('en-SG')}`;
  const source = String(payload.source ?? 'manual').trim() || 'manual';

  if (!content) {
    return {
      statusCode: 400,
      payload: { error: 'Profile content is required.' },
    };
  }

  const version = {
    id: crypto.randomUUID(),
    name,
    content,
    source,
    createdAt: new Date().toISOString(),
  };

  await storage.insertProfileVersion(version);

  if (payload.makeActive !== false) {
    await setActiveProfile(version.id);
  }

  return {
    statusCode: 201,
    payload: version,
  };
}

async function setActiveProfile(profileId) {
  const version = await storage.getProfileVersion(profileId);

  if (!version) {
    return null;
  }

  await setSetting('activeProfileId', version.id);
  await setSetting('currentProfile', version.content);
  await setSetting('updatedAt', new Date().toISOString());
  return version;
}

async function deleteProfileVersion(profileId) {
  await storage.deleteProfileVersion(profileId);

  if ((await getSetting('activeProfileId')) === profileId) {
    await setSetting('activeProfileId', '');
  }
}

function parseLinkedInAlertEmail(rawEmail) {
  const normalizedEmail = rawEmail.replace(/\r\n/g, '\n');
  const lines = normalizedEmail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const urlIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /https?:\/\/\S+/i.test(line))
    .filter(({ line }) => /linkedin\.com|lnkd\.in/i.test(line));

  const jobs = urlIndexes
    .map(({ line, index }) => {
      const url = cleanUrl(line.match(/https?:\/\/\S+/i)?.[0] ?? '');
      const blockLines = lines.slice(Math.max(0, index - 8), Math.min(lines.length, index + 4));
      return buildImportedJob(blockLines, url);
    })
    .filter(Boolean);

  if (jobs.length > 0) {
    return uniqueImportedJobs(jobs);
  }

  const blocks = normalizedEmail
    .split(/\n\s*\n/g)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length >= 2);

  return uniqueImportedJobs(blocks.map((block) => buildImportedJob(block, '')).filter(Boolean));
}

function buildImportedJob(blockLines, url) {
  const cleanLines = blockLines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/https?:\/\//i.test(line))
    .filter((line) => !isEmailNoiseLine(line));

  if (cleanLines.length === 0) {
    return null;
  }

  const titleIndex = cleanLines.findIndex(isRoleLine);
  const title = cleanLines[titleIndex >= 0 ? titleIndex : 0];

  if (!title || title.length < 3) {
    return null;
  }

  const afterTitle = cleanLines.slice((titleIndex >= 0 ? titleIndex : 0) + 1);
  const location = afterTitle.find(isLocationLine) ?? cleanLines.find(isLocationLine) ?? 'Singapore';
  const company = afterTitle.find((line) => !isLocationLine(line) && !isEmailMetadataLine(line)) ?? 'Unknown company';
  const sourceBlock = blockLines.join('\n');

  return {
    title: title.replace(/^job alert:?\s*/i, '').trim(),
    company: company.replace(/^company:?\s*/i, '').trim(),
    location,
    url,
    description: sourceBlock,
    sponsorship: /sponsor|employment pass|work pass|ep\b/i.test(sourceBlock),
    sourceBlock,
  };
}

function uniqueImportedJobs(jobs) {
  const seen = new Set();
  const uniqueJobs = [];

  for (const job of jobs) {
    const key = job.url || `${job.title.toLowerCase()}:${job.company.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueJobs.push(job);
  }

  return uniqueJobs;
}

function cleanUrl(url) {
  return url.replace(/[),.;\]]+$/g, '');
}

function isRoleLine(line) {
  return /developer|engineer|programmer|architect|analyst|consultant|java|spring|backend|software|platform|devops|full stack|full-stack/i.test(line);
}

function isLocationLine(line) {
  return /singapore|remote|hybrid|on-site|onsite|asia|apac|cbd/i.test(line);
}

function isEmailMetadataLine(line) {
  return /full-time|part-time|contract|temporary|internship|remote|hybrid|on-site|onsite|applicants?|applicant|promoted|posted|ago|easy apply/i.test(line);
}

function isEmailNoiseLine(line) {
  if (/^job alert:?\s+.+/i.test(line)) {
    return false;
  }

  return (
    isEmailMetadataLine(line) ||
    /linkedin|view job|view jobs|apply now|see more|job alert|recommended for you|based on your profile|unsubscribe|manage alerts|privacy|help center|copyright|download the app|this email|notification|new jobs|jobs for you|similar jobs|be an early applicant|actively hiring/i.test(
      line,
    )
  );
}

function gmailIsConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function requestOrigin(request) {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  const proto = request.headers['x-forwarded-proto'] ?? (process.env.RENDER ? 'https' : 'http');

  if (!host) {
    return `http://localhost:${port}`;
  }

  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
}

function googleRedirectUri(request) {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.GOOGLE_REDIRECT_URI?.replace(/\/api\/gmail\/oauth\/callback$/, '');
  return `${baseUrl || (request ? requestOrigin(request) : `http://localhost:${port}`)}/api/gmail/oauth/callback`;
}

async function gmailAuthUrl(request) {
  if (!gmailIsConfigured()) {
    return null;
  }

  const state = crypto.randomUUID();
  const redirectUri = googleRedirectUri(request);
  await setSetting('gmailOAuthState', state);
  await setSetting('gmailRedirectUri', redirectUri);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCode(code) {
  const redirectUri = (await getSetting('gmailRedirectUri')) || googleRedirectUri();

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? 'Google OAuth token exchange failed.');
  }

  if (payload.refresh_token) {
    await setSetting('gmailRefreshToken', payload.refresh_token);
  }

  return payload;
}

async function gmailAccessToken() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || (await getSetting('gmailRefreshToken'));

  if (!gmailIsConfigured() || !refreshToken) {
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? 'Unable to refresh Gmail access token.');
  }

  return payload.access_token;
}

async function readGmailSettings() {
  const maxResults = Number((await getSetting('gmailMaxResults')) ?? process.env.GMAIL_MAX_RESULTS ?? 10);

  return {
    configured: gmailIsConfigured(),
    connected: Boolean(process.env.GOOGLE_REFRESH_TOKEN || (await getSetting('gmailRefreshToken'))),
    query: (await getSetting('gmailQuery')) || process.env.GMAIL_QUERY || defaultGmailQuery,
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.min(maxResults, 50) : 10,
  };
}

async function writeGmailSettings(payload = {}) {
  const current = await readGmailSettings();
  const query = String(payload.query ?? current.query).trim() || current.query;
  const maxResults = Number(payload.maxResults ?? current.maxResults);
  const normalizedMaxResults = Number.isFinite(maxResults) && maxResults > 0 ? Math.min(Math.round(maxResults), 50) : 10;

  await setSetting('gmailQuery', query);
  await setSetting('gmailMaxResults', String(normalizedMaxResults));

  return readGmailSettings();
}

async function fetchGmailLinkedInJobs(options = {}) {
  const token = await gmailAccessToken();

  if (!token) {
    return {
      statusCode: 400,
      payload: {
        error:
          'Gmail is not connected. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then use Connect Gmail.',
      },
    };
  }

  const settings = await writeGmailSettings(options);
  const query = settings.query;
  const maxResults = settings.maxResults;
  const attemptedQueries = uniqueStrings([query, ...gmailJobAlertFallbackQueries]);
  let listPayload = null;
  let usedQuery = query;
  let lastListError = null;

  for (const candidateQuery of attemptedQueries) {
    const result = await listGmailMessages(token, candidateQuery, maxResults);

    if (!result.ok) {
      lastListError = {
        status: result.status,
        message: result.payload.error?.message ?? 'Unable to read Gmail messages.',
      };
      continue;
    }

    listPayload = result.payload;
    usedQuery = candidateQuery;

    if ((listPayload.messages ?? []).length > 0) {
      break;
    }
  }

  if (!listPayload) {
    return {
      statusCode: lastListError?.status ?? 502,
      payload: {
        error: lastListError?.message ?? 'Unable to read Gmail messages.',
      },
    };
  }

  const messages = listPayload.messages ?? [];
  const jobs = [];
  const scannedMessages = [];

  for (const message of messages) {
    const messagePayload = await readGmailMessage(token, message.id);

    if (!messagePayload) {
      continue;
    }

    const headers = gmailHeaders(messagePayload.payload?.headers ?? []);
    const body = extractGmailBody(messagePayload.payload);
    const parsedJobs = parseLinkedInAlertEmail(body);
    jobs.push(...parsedJobs);
    scannedMessages.push({
      id: message.id,
      subject: headers.subject ?? '(No subject)',
      from: headers.from ?? 'Unknown sender',
      date: headers.date ?? '',
      jobsFound: parsedJobs.length,
      snippet: messagePayload.snippet ?? '',
    });
  }

  return {
    statusCode: 200,
    payload: {
      query: usedQuery,
      requestedQuery: query,
      attemptedQueries,
      maxResults,
      jobs: uniqueImportedJobs(jobs),
      messagesScanned: messages.length,
      scannedMessages,
    },
  };
}

async function listGmailMessages(token, query, maxResults) {
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', String(maxResults));

  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const listPayload = await listResponse.json();

  return {
    ok: listResponse.ok,
    status: listResponse.status,
    payload: listPayload,
  };
}

async function readGmailMessage(token, messageId) {
  const messageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const messageResponse = await fetch(messageUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!messageResponse.ok) {
    return null;
  }

  return messageResponse.json();
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function gmailHeaders(headers) {
  return Object.fromEntries(headers.map((header) => [String(header.name ?? '').toLowerCase(), String(header.value ?? '')]));
}

function extractGmailBody(payload) {
  const chunks = [];
  collectGmailParts(payload, chunks);
  return chunks.join('\n\n');
}

function collectGmailParts(part, chunks) {
  if (!part) {
    return;
  }

  if (part.body?.data && ['text/plain', 'text/html'].includes(part.mimeType)) {
    const decoded = base64UrlDecode(part.body.data);
    chunks.push(part.mimeType === 'text/html' ? stripHtml(decoded) : decoded);
  }

  for (const child of part.parts ?? []) {
    collectGmailParts(child, chunks);
  }
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function stripHtml(value) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractText(responseJson) {
  if (typeof responseJson.output_text === 'string') {
    return responseJson.output_text;
  }

  const chunks = [];

  for (const item of responseJson.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseTailoringJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? text;
  return JSON.parse(jsonText);
}

function buildPrompt({ profile, job }) {
  return [
    'Return only valid JSON with this exact shape:',
    '{',
    '  "resumeBullets": ["3 to 5 concise resume bullets"],',
    '  "coverLetter": "short tailored cover letter",',
    '  "recruiterMessage": "short LinkedIn recruiter message",',
    '  "fitNotes": ["2 to 4 reasons this role fits or does not fit"]',
    '}',
    '',
    'Rules:',
    '- Do not invent employers, dates, certifications, degrees, or years of experience.',
    '- Use the candidate profile and job text only.',
    '- Keep bullets specific to Java/Spring/backend/cloud work when relevant.',
    '- Mention Employment Pass sponsorship only if the job text says it.',
    '- Keep the tone professional and direct.',
    '',
    'Candidate profile:',
    profile,
    '',
    'Job:',
    JSON.stringify(job, null, 2),
  ].join('\n');
}

async function tailorApplication(payload) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      statusCode: 503,
      payload: {
        error: 'OPENAI_API_KEY is not set. Start the server with an API key to generate AI drafts.',
      },
    };
  }

  const profile = String(payload.profile ?? '').trim();
  const job = payload.job ?? {};

  if (!profile || !job.title || !job.company || !job.description) {
    return {
      statusCode: 400,
      payload: {
        error: 'profile, job.title, job.company, and job.description are required.',
      },
    };
  }

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions:
        'You are a career application assistant helping a Java/Spring/cloud engineer tailor job application material. Return JSON only.',
      input: buildPrompt({ profile, job }),
      temperature: 0.3,
      store: false,
    }),
  });

  const responseJson = await apiResponse.json();

  if (!apiResponse.ok) {
    return {
      statusCode: apiResponse.status,
      payload: {
        error: responseJson.error?.message ?? 'OpenAI request failed.',
      },
    };
  }

  const text = extractText(responseJson);
  const tailored = parseTailoringJson(text);

  return {
    statusCode: 200,
    payload: tailored,
  };
}

function isAuthorized(request, url) {
  if (!process.env.APP_PASSWORD || url.pathname === '/api/health' || url.pathname === '/api/gmail/oauth/callback') {
    return true;
  }

  const authorization = request.headers.authorization ?? '';

  if (!authorization.startsWith('Basic ')) {
    return false;
  }

  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return username === (process.env.APP_USERNAME || 'applypilot') && password === process.env.APP_PASSWORD;
}

async function serveStatic(response, url) {
  const pathname = decodeURIComponent(url.pathname);
  const safePath = normalizePath(pathname).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = join(staticRoot, requestedPath);

  if (!filePath.startsWith(staticRoot)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
    });
    response.end(content);
  } catch {
    try {
      const index = await readFile(join(staticRoot, 'index.html'));
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
      });
      response.end(index);
    } catch {
      sendJson(response, 404, { error: 'Build not found. Run npm.cmd run build first.' });
    }
  }
}

function contentType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  };

  return types[extname(filePath)] ?? 'application/octet-stream';
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (!isAuthorized(request, url)) {
    sendUnauthorized(response);
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', storage: storage.type });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await readAppState());
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const payload = await readJson(request);
      sendJson(response, 200, await writeAppState(payload));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/profiles') {
      sendJson(response, 200, {
        activeProfileId: await getSetting('activeProfileId'),
        profileVersions: await readProfileVersions(),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/profiles') {
      const payload = await readJson(request);
      const result = await addProfileVersion(payload);
      sendJson(response, result.statusCode, result.payload);
      return;
    }

    const activateProfileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/activate$/);
    if (request.method === 'POST' && activateProfileMatch) {
      const version = await setActiveProfile(activateProfileMatch[1]);
      sendJson(response, version ? 200 : 404, version ? await readAppState() : { error: 'Profile version not found.' });
      return;
    }

    const deleteProfileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteProfileMatch) {
      await deleteProfileVersion(deleteProfileMatch[1]);
      sendJson(response, 200, { status: 'deleted' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/gmail/auth-url') {
      const authUrl = await gmailAuthUrl(request);
      sendJson(response, authUrl ? 200 : 400, authUrl ? { url: authUrl } : { error: 'Google OAuth is not configured.' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/gmail/settings') {
      sendJson(response, 200, await readGmailSettings());
      return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/gmail/settings') {
      const payload = await readJson(request);
      sendJson(response, 200, await writeGmailSettings(payload));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/gmail/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || state !== (await getSetting('gmailOAuthState'))) {
        sendHtml(response, 400, '<h1>Gmail connection failed</h1><p>Invalid OAuth callback.</p>');
        return;
      }

      await exchangeGoogleCode(code);
      sendHtml(response, 200, '<h1>Gmail connected</h1><p>You can close this tab and return to ApplyPilot.</p>');
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/gmail/import') {
      const payload = await readJson(request);
      const result = await fetchGmailLinkedInJobs(payload);
      sendJson(response, result.statusCode, result.payload);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/tailor') {
      const payload = await readJson(request);
      const result = await tailorApplication(payload);
      sendJson(response, result.statusCode, result.payload);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(response, url);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
    });
  }
});

server.listen(port, () => {
  console.log(`ApplyPilot server listening on http://localhost:${port}`);
  console.log(storage.label);
  console.log(`Model: ${model}`);
  if (process.env.APP_PASSWORD) {
    console.log(`Private auth enabled for user: ${process.env.APP_USERNAME || 'applypilot'}`);
  }
});
