'use strict';

const https = require('https');

let clientPromise;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function getMongoClient() {
  try {
    return require('mongodb').MongoClient;
  } catch (error) {
    return require('hexo-chfy-essay/node_modules/mongodb').MongoClient;
  }
}

function getMongoUri() {
  return process.env.CHFY_ESSAY_MONGODB_URI
    || process.env.MONGODB_URI
    || process.env.MONGO_URL
    || '';
}

function getRedisConfig() {
  const url = process.env.CHFY_ESSAY_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL
    || '';
  const token = process.env.CHFY_ESSAY_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || '';
  return { url: url.replace(/\/+$/g, ''), token };
}

function getDatabaseName(uri) {
  if (process.env.CHFY_ESSAY_MONGODB_DB) return process.env.CHFY_ESSAY_MONGODB_DB;
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  try {
    const parsed = new URL(uri);
    const name = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    return name || 'twikoo';
  } catch (error) {
    return 'twikoo';
  }
}

async function collection() {
  const uri = getMongoUri();
  if (!uri) {
    const error = new Error('Missing MongoDB URI. Set CHFY_ESSAY_MONGODB_URI or MONGODB_URI.');
    error.statusCode = 501;
    throw error;
  }

  if (!clientPromise) {
    const MongoClient = getMongoClient();
    clientPromise = new MongoClient(uri).connect();
  }

  const client = await clientPromise;
  const db = client.db(getDatabaseName(uri));
  return db.collection(process.env.CHFY_ESSAY_LIKES_COLLECTION || 'chfy_essay_likes');
}

function redisKey(key) {
  return 'chfy-essay:likes:' + key;
}

function redisRequest(command) {
  const config = getRedisConfig();
  if (!config.url || !config.token) {
    const error = new Error('Missing Redis REST config. Set KV_REST_API_URL and KV_REST_API_TOKEN on Vercel.');
    error.statusCode = 501;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(config.url);
    const body = JSON.stringify(command);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname.replace(/\/+$/g, '') + '/',
      port: url.port || 443,
      headers: {
        Authorization: 'Bearer ' + config.token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(error);
          return;
        }

        if (response.statusCode >= 400 || data.error) {
          const error = new Error(data.error || 'Redis request failed.');
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }

        resolve(data.result);
      });
    });

    req.on('error', reject);
    req.setTimeout(7000, () => {
      req.destroy(new Error('Redis request timed out. Check KV_REST_API_URL and KV_REST_API_TOKEN.'));
    });
    req.write(body);
    req.end();
  });
}

async function getRedisCounts(keys) {
  if (!keys.length) return {};
  const result = await redisRequest(['MGET'].concat(keys.map(redisKey)));
  const values = Array.isArray(result) ? result : [];
  return keys.reduce((counts, key, index) => {
    counts[key] = Math.max(0, Number(values[index] || 0));
    return counts;
  }, {});
}

async function updateRedisLike(key, delta) {
  const name = redisKey(key);
  let count = delta > 0
    ? Number(await redisRequest(['INCRBY', name, 1]))
    : Number(await redisRequest(['DECRBY', name, 1]));

  if (!Number.isFinite(count)) count = 0;
  if (count < 0) {
    await redisRequest(['SET', name, 0]);
    count = 0;
  }

  return count;
}

function cleanKey(value) {
  const key = String(value || '').trim();
  return key && key.length <= 300 ? key : '';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 32) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

async function getLikes(req, res) {
  const url = requestUrl(req);
  const rawKeys = url.searchParams.getAll('keys');
  const keys = (rawKeys.length ? rawKeys : [url.searchParams.get('keys') || ''])
    .flatMap((key) => String(key || '').split(','))
    .map((key) => cleanKey(key))
    .filter(Boolean);
  const uniqueKeys = Array.from(new Set(keys)).slice(0, 100);
  const counts = {};

  uniqueKeys.forEach((key) => {
    counts[key] = 0;
  });

  if (!uniqueKeys.length) {
    json(res, 200, { ok: true, counts });
    return;
  }

  const redisConfig = getRedisConfig();
  if (redisConfig.url && redisConfig.token) {
    json(res, 200, { ok: true, counts: Object.assign(counts, await getRedisCounts(uniqueKeys)) });
    return;
  }

  const docs = await (await collection())
    .find({ _id: { $in: uniqueKeys } })
    .project({ count: 1 })
    .toArray();

  docs.forEach((doc) => {
    counts[doc._id] = Math.max(0, Number(doc.count || 0));
  });

  json(res, 200, { ok: true, counts });
}

async function updateLike(req, res) {
  const body = await readBody(req);
  const key = cleanKey(body.key);
  const delta = Number(body.delta) > 0 ? 1 : -1;
  if (!key) {
    json(res, 400, { ok: false, error: { message: 'Invalid essay key.' } });
    return;
  }

  const redisConfig = getRedisConfig();
  if (redisConfig.url && redisConfig.token) {
    json(res, 200, { ok: true, key, count: await updateRedisLike(key, delta) });
    return;
  }

  const likes = await collection();
  const now = new Date();
  if (delta > 0) {
    await likes.updateOne(
      { _id: key },
      { $inc: { count: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  } else {
    await likes.updateOne(
      { _id: key, count: { $gt: 0 } },
      { $inc: { count: -1 }, $set: { updatedAt: now } }
    );
  }

  const doc = await likes.findOne({ _id: key }, { projection: { count: 1 } });
  json(res, 200, { ok: true, key, count: Math.max(0, Number((doc && doc.count) || 0)) });
}

module.exports = async function chfyEssayLikes(req, res) {
  try {
    if (req.method === 'GET') {
      await getLikes(req, res);
      return;
    }

    if (req.method === 'POST') {
      await updateLike(req, res);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    json(res, 405, { ok: false, error: { message: 'Method not allowed.' } });
  } catch (error) {
    json(res, error.statusCode || 500, {
      ok: false,
      error: { message: error.message || 'Like service error.' }
    });
  }
};
