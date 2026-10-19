/** Embedded PostgreSQL (PGlite), persisted on Horizon Site /data volume. */
import { PGlite } from '@electric-sql/pglite';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const DATA_DIR = '/data/horizon-agents-postgres';
const AUDIENCE = 'horizon-maestro-state';
const ISSUER = 'https://token.actions.githubusercontent.com';
const WORKFLOW = 'danielnep/May-Maestro-Executor/.github/workflows/chat-requests.yml@refs/heads/main';
const SMOKE_WORKFLOW = 'danielnep/May-Maestro-Executor/.github/workflows/agent-state-smoke.yml@refs/heads/main';
const SUBJECT = 'repo:danielnep@63399664/May-Maestro-Executor@1423033369:ref:refs/heads/main';
const MAX_SNAPSHOT = 20 * 1024 * 1024;
let databasePromise;
let jwksCache = { expires: 0, keys: [] };
let compactWrites = 0;

export function initAgentDatabase() {
  if (!databasePromise) databasePromise = (async () => {
    const pg = await PGlite.create(DATA_DIR);
    // Recycle PostgreSQL WAL before allocating additional tables: the 500 MB
    // existing volume has previously exhausted its free pages under MVCC writes.
    await pg.exec('CHECKPOINT');
    await pg.exec('VACUUM');
    await pg.exec('CREATE TABLE IF NOT EXISTS horizon_agent_snapshots (key TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), snapshot BYTEA NOT NULL, checksum TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pg.exec('CREATE TABLE IF NOT EXISTS horizon_agent_snapshots_compact (key TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), snapshot BYTEA NOT NULL, checksum TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const compact = await pg.query("SELECT revision FROM horizon_agent_snapshots_compact WHERE key='primary'");
    if (!compact.rows.length) {
      const old = await pg.query("SELECT revision, replace(encode(snapshot,'base64'),chr(10),'') AS snapshot,checksum FROM horizon_agent_snapshots WHERE key='primary'");
      if (old.rows.length) {
        const source = Buffer.from(old.rows[0].snapshot,'base64');
        if (createHash('sha256').update(source).digest('hex') !== old.rows[0].checksum)
          throw Error('Legacy snapshot integrity mismatch; migration aborted safely');
        const packed = gzipSync(source,{level:6}).toString('base64');
        await pg.query("INSERT INTO horizon_agent_snapshots_compact(key,revision,snapshot,checksum) VALUES('primary',$1,decode($2,'base64'),$3) ON CONFLICT(key) DO NOTHING", [old.rows[0].revision,packed,old.rows[0].checksum]);
        console.log('[horizon-agent-db] migrated original snapshot to gzip; revision '+old.rows[0].revision);
      }
    }
    const live = await pg.query("SELECT revision FROM horizon_agent_snapshots_compact WHERE key='primary'");
    if (live.rows.length) {
      const stale = await pg.query("SELECT revision FROM horizon_agent_snapshots WHERE key='primary'");
      if (stale.rows.length) {
        // Only recycle the space-heavy original after verified compact insertion.
        await pg.exec('TRUNCATE horizon_agent_snapshots');
        await pg.exec('CHECKPOINT');
        console.log('[horizon-agent-db] recycled legacy uncompressed storage');
      }
    }
    return pg;
  })().catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}
function b64urlJSON(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}
async function validOidc(authorization, method) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const jwt = authorization.slice(7);
  if (jwt.length > 12000 || jwt.length < 100) return false;
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;
  let header, claims;
  try { header = b64urlJSON(parts[0]); claims = b64urlJSON(parts[1]); }
  catch { return false; }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string'
    || claims.iss !== ISSUER || claims.sub !== SUBJECT
    || claims.repository !== 'danielnep/May-Maestro-Executor'
    || claims.ref !== 'refs/heads/main'
    || !(claims.workflow_ref === WORKFLOW || (method === 'GET' && claims.workflow_ref === SMOKE_WORKFLOW))
    || !(claims.aud === AUDIENCE || (Array.isArray(claims.aud) && claims.aud.includes(AUDIENCE)))
    || !Number.isInteger(claims.exp) || claims.exp <= now || claims.exp > now + 3600
    || !Number.isInteger(claims.iat) || claims.iat > now + 60
    || (claims.nbf !== undefined && claims.nbf > now + 60)) return false;
  if (jwksCache.expires < Date.now()) {
    const response = await fetch(ISSUER + '/.well-known/jwks', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) return false;
    const data = await response.json();
    if (!Array.isArray(data.keys)) return false;
    jwksCache = {keys: data.keys, expires: Date.now() + 10 * 60 * 1000};
  }
  const jwk = jwksCache.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) return false;
  try {
    return verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
      createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { return false; }
}
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(res, status, payload) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff'});
  res.end(JSON.stringify(payload));
}
export async function handleAgentState(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, {error:'method_not_allowed'}); return;
  }
  try {
    if (!await validOidc(req.headers.authorization, req.method)) {
      json(res, 401, {error:'unauthorized'}); return;
    }
    const pg = await initAgentDatabase();
    if (req.method === 'GET') {
      const rows = await pg.query("SELECT revision, replace(encode(snapshot, 'base64'), chr(10), '') AS snapshot, checksum FROM horizon_agent_snapshots_compact WHERE key = 'primary'");
      const row = rows.rows[0];
      if (!row) {json(res,200,{revision:0,snapshot:null,checksum:null});return;}
      const restored = gunzipSync(Buffer.from(row.snapshot,'base64'),{maxOutputLength:MAX_SNAPSHOT});
      if (createHash('sha256').update(restored).digest('hex') !== row.checksum)
        throw Error('Compact snapshot integrity mismatch');
      json(res,200,{revision:row.revision,snapshot:restored.toString('base64'),checksum:row.checksum});
      return;
    }
    const data = await readBody(req, Math.ceil(MAX_SNAPSHOT * 4 / 3) + 2048);
    if (!Number.isSafeInteger(data.revision) || data.revision < 0 ||
        typeof data.snapshot !== 'string' || data.snapshot.length > Math.ceil(MAX_SNAPSHOT * 4 / 3) + 10 ||
        typeof data.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(data.checksum)) {
      json(res, 400, {error:'invalid_snapshot'}); return;
    }
    const bytes = Buffer.from(data.snapshot, 'base64');
    if (bytes.length < 100 || bytes.length > MAX_SNAPSHOT ||
        bytes.subarray(0,16).toString('ascii') !== 'SQLite format 3\u0000' ||
        bytes.toString('base64') !== data.snapshot ||
        createHash('sha256').update(bytes).digest('hex') !== data.checksum) {
      json(res, 400, {error:'invalid_snapshot'}); return;
    }
    const packed = gzipSync(bytes,{level:6}).toString('base64');
    let result;
    if (data.revision === 0) {
      result = await pg.query("INSERT INTO horizon_agent_snapshots_compact (key,revision,snapshot,checksum) VALUES ('primary',1,decode($1,'base64'),$2) ON CONFLICT (key) DO NOTHING RETURNING revision", [packed,data.checksum]);
    } else {
      result = await pg.query("UPDATE horizon_agent_snapshots_compact SET revision=revision+1,snapshot=decode($1,'base64'),checksum=$2,updated_at=now() WHERE key='primary' AND revision=$3 RETURNING revision", [packed,data.checksum,data.revision]);
    }
    if (result.rows.length !== 1) {
      json(res, 409, {error:'revision_conflict'}); return;
    }
    // PGlite does not reliably run autovacuum in embedded single-user mode.
    // Periodic vacuum and checkpoint bound MVCC/TOAST/WAL growth on this volume.
    if (++compactWrites % 12 === 0) {
      try {await pg.exec('VACUUM horizon_agent_snapshots_compact');await pg.exec('CHECKPOINT');}
      catch (maintenanceError) {console.error('[horizon-agent-db] maintenance pending',maintenanceError?.message?.slice(0,90));}
    }
    json(res, 200, {revision:result.rows[0].revision,checksum:data.checksum});
  } catch (error) {
    console.error('[horizon-agent-db]', error?.message?.slice(0, 160) || 'unknown_error');
    json(res, 503, {error:'agent_storage_unavailable'});
  }
}
