'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const qiniu = require('qiniu');
const { mergeEnvironment, parseEnv, readEnvFile } = require('../config/environment');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CDN_BASE_URL = 'https://qny.luckyblank.cn';
const DEFAULT_KEY_PREFIX = 'live2d-pet';
const DEFAULT_REFRESH_ENDPOINT = 'https://fusion.qiniuapi.com/v2/tune/refresh';
const DEFAULT_RESUME_THRESHOLD_MB = 4;
const DEFAULT_TOKEN_TTL_SECONDS = 7200;
const DEFAULT_HTTP_TIMEOUT_MS = 30000;

function parseArguments(argv) {
  const options = {
    dryRun: false,
    skipRefresh: false,
    help: false,
    envFile: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--skip-refresh') {
      options.skipRefresh = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--env-file') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--env-file requires a path');
      }
      options.envFile = argv[index];
    } else if (argument.startsWith('--env-file=')) {
      options.envFile = argument.slice('--env-file='.length);
      if (!options.envFile) {
        throw new Error('--env-file requires a path');
      }
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }

  return options;
}

function printHelp() {
  console.log([
    'Upload release artifacts to Qiniu Kodo and refresh CDN cache.',
    '',
    'Usage:',
    '  node scripts/release-upload.js [options]',
    '',
    'Options:',
    '  --dry-run            Validate artifacts and print the upload plan only',
    '  --skip-refresh       Upload files without submitting a CDN refresh',
    '  --env-file <path>    Load variables from a file other than .env',
    '  -h, --help           Show this help'
  ].join('\n'));
}

function loadEnvironment(projectRoot, options, processEnvironment = process.env) {
  const explicitEnvFile = options.envFile || processEnvironment.RELEASE_ENV_FILE;
  const envFile = explicitEnvFile || '.env';
  const envPath = path.isAbsolute(envFile)
    ? envFile
    : path.resolve(projectRoot, envFile);

  const fileResult = readEnvFile(envPath, { required: Boolean(explicitEnvFile) });
  if (fileResult.loaded) {
    console.log('[release] Loaded environment file: ' + envPath);
  }

  return mergeEnvironment(fileResult.values, processEnvironment);
}

function parseBoolean(value, defaultValue, name) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(name + ' must be true or false');
}

function parsePositiveNumber(value, defaultValue, name) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(name + ' must be a positive number');
  }
  return parsed;
}

function resolveProjectPath(projectRoot, configuredPath) {
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(projectRoot, configuredPath);
}

function normalizeObjectName(value, label) {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(label + ' is not a safe relative object name: ' + value);
  }

  return segments.join('/');
}

function normalizeKeyPrefix(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    return '';
  }
  return normalizeObjectName(normalized, 'QINIU_KEY_PREFIX');
}

function joinObjectKey(prefix, objectName) {
  const safePrefix = normalizeKeyPrefix(prefix);
  const safeObjectName = normalizeObjectName(objectName, 'object name');
  return safePrefix ? safePrefix + '/' + safeObjectName : safeObjectName;
}

function buildCdnUrl(baseUrl, objectKey) {
  const parsedBase = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedBase.protocol)) {
    throw new Error('QINIU_CDN_BASE_URL must use http or https');
  }
  if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    throw new Error('QINIU_CDN_BASE_URL must not contain credentials, query, or hash');
  }

  const encodedKey = normalizeObjectName(objectKey, 'object key')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseWithSlash = parsedBase.toString().replace(/\/+$/, '') + '/';
  return new URL(encodedKey, baseWithSlash).toString();
}

function stripYamlScalar(value) {
  const trimmed = String(value).trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') ||
      (trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}

function parseLatestYml(contents) {
  const text = String(contents);
  const versionMatch = text.match(/^\s*version:\s*(.+?)\s*$/m);
  const pathMatch = text.match(/^\s*path:\s*(.+?)\s*$/m);

  if (!versionMatch) {
    throw new Error('dist/latest.yml is missing version');
  }
  if (!pathMatch) {
    throw new Error('dist/latest.yml is missing path');
  }

  return {
    version: stripYamlScalar(versionMatch[1]),
    path: normalizeObjectName(stripYamlScalar(pathMatch[1]), 'latest.yml path')
  };
}

function assertFile(localPath, label) {
  let stat;
  try {
    stat = fs.statSync(localPath);
  } catch {
    throw new Error(label + ' does not exist: ' + localPath);
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(label + ' is empty or is not a file: ' + localPath);
  }
  return stat;
}

function createReleasePlan(projectRoot, environment) {
  const packagePath = path.join(projectRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const version = String(packageJson.version || '').trim();
  if (!version) {
    throw new Error('package.json is missing version');
  }

  const distDir = resolveProjectPath(
    projectRoot,
    environment.RELEASE_DIST_DIR || 'dist'
  );
  const releaseNotesDir = resolveProjectPath(
    projectRoot,
    environment.RELEASE_NOTES_DIR || 'release'
  );
  const manifestPath = path.join(distDir, 'latest.yml');
  assertFile(manifestPath, 'Update manifest');

  const manifest = parseLatestYml(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version) {
    throw new Error(
      'dist/latest.yml version ' + manifest.version +
      ' does not match package.json version ' + version
    );
  }
  if (!/\.exe$/i.test(manifest.path)) {
    throw new Error('latest.yml path must point to a Windows .exe installer');
  }

  const installerPath = path.resolve(
    distDir,
    ...manifest.path.split('/')
  );
  const relativeInstallerPath = path.relative(distDir, installerPath);
  if (
    relativeInstallerPath.startsWith('..' + path.sep) ||
    path.isAbsolute(relativeInstallerPath)
  ) {
    throw new Error('latest.yml path escapes the dist directory');
  }

  const releaseNotesName = 'release-notes-' + version + '.md';
  const releaseNotesPath = path.join(releaseNotesDir, releaseNotesName);
  const keyPrefix = normalizeKeyPrefix(
    environment.QINIU_KEY_PREFIX === undefined
      ? DEFAULT_KEY_PREFIX
      : environment.QINIU_KEY_PREFIX
  );
  const cdnBaseUrl = environment.QINIU_CDN_BASE_URL || DEFAULT_CDN_BASE_URL;

  const files = [
    {
      label: 'Windows installer',
      localPath: installerPath,
      objectKey: joinObjectKey(keyPrefix, manifest.path),
      contentType: 'application/vnd.microsoft.portable-executable'
    },
    {
      label: 'Release notes',
      localPath: releaseNotesPath,
      objectKey: joinObjectKey(keyPrefix, releaseNotesName),
      contentType: 'text/markdown; charset=utf-8'
    },
    {
      label: 'Update manifest',
      localPath: manifestPath,
      objectKey: joinObjectKey(keyPrefix, 'latest.yml'),
      contentType: 'application/x-yaml; charset=utf-8'
    }
  ];

  files.forEach((file) => {
    file.stat = assertFile(file.localPath, file.label);
    file.cdnUrl = buildCdnUrl(cdnBaseUrl, file.objectKey);
  });

  return {
    version,
    distDir,
    releaseNotesDir,
    keyPrefix,
    cdnBaseUrl,
    files
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes + ' B';
  }

  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
}

function printReleasePlan(plan, environment, refreshEnabled, dryRun) {
  console.log('[release] Version: ' + plan.version);
  console.log('[release] Bucket: ' + (environment.QINIU_BUCKET || '<not configured>'));
  console.log('[release] Object prefix: ' + (plan.keyPrefix || '<root>'));
  console.log('[release] Mode: ' + (dryRun ? 'dry run' : 'upload'));

  plan.files.forEach((file, index) => {
    console.log(
      '[release] ' + (index + 1) + '. ' + file.localPath +
      ' -> ' + file.objectKey + ' (' + formatBytes(file.stat.size) + ')'
    );
  });

  if (refreshEnabled) {
    console.log('[release] CDN refresh URLs:');
    plan.files.forEach((file) => console.log('[release]   ' + file.cdnUrl));
  } else {
    console.log('[release] CDN refresh disabled');
  }
}

function requireEnvironment(environment, names) {
  const missing = names.filter((name) => !String(environment[name] || '').trim());
  if (missing.length > 0) {
    throw new Error('Missing required environment variables: ' + missing.join(', '));
  }
}

function resolveUploadZone(region) {
  const normalized = String(region || 'auto').trim().toLowerCase();
  const zones = {
    auto: null,
    z0: qiniu.zone.Zone_z0,
    'cn-east-2': qiniu.zone.Zone_cn_east_2,
    cn_east_2: qiniu.zone.Zone_cn_east_2,
    z1: qiniu.zone.Zone_z1,
    z2: qiniu.zone.Zone_z2,
    na0: qiniu.zone.Zone_na0,
    as0: qiniu.zone.Zone_as0
  };

  if (!Object.prototype.hasOwnProperty.call(zones, normalized)) {
    throw new Error(
      'QINIU_REGION must be one of auto, z0, cn-east-2, z1, z2, na0, as0'
    );
  }
  return zones[normalized];
}

function createUploadContext(environment) {
  requireEnvironment(environment, [
    'QINIU_ACCESS_KEY',
    'QINIU_SECRET_KEY',
    'QINIU_BUCKET'
  ]);

  const mac = new qiniu.auth.digest.Mac(
    environment.QINIU_ACCESS_KEY,
    environment.QINIU_SECRET_KEY
  );
  const uploadConfig = new qiniu.conf.Config({
    useHttpsDomain: true,
    accelerateUploading: parseBoolean(
      environment.QINIU_UPLOAD_ACCELERATE,
      false,
      'QINIU_UPLOAD_ACCELERATE'
    )
  });
  const zone = resolveUploadZone(environment.QINIU_REGION);
  if (zone) {
    uploadConfig.zone = zone;
  }

  return {
    mac,
    uploadConfig,
    bucket: environment.QINIU_BUCKET,
    tokenTtlSeconds: parsePositiveNumber(
      environment.QINIU_UPLOAD_TOKEN_TTL_SECONDS,
      DEFAULT_TOKEN_TTL_SECONDS,
      'QINIU_UPLOAD_TOKEN_TTL_SECONDS'
    ),
    resumeThresholdBytes:
      parsePositiveNumber(
        environment.QINIU_RESUME_THRESHOLD_MB,
        DEFAULT_RESUME_THRESHOLD_MB,
        'QINIU_RESUME_THRESHOLD_MB'
      ) * 1024 * 1024,
    httpTimeoutMs: parsePositiveNumber(
      environment.QINIU_HTTP_TIMEOUT_MS,
      DEFAULT_HTTP_TIMEOUT_MS,
      'QINIU_HTTP_TIMEOUT_MS'
    )
  };
}

function createUploadToken(context, objectKey) {
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: context.bucket + ':' + objectKey,
    insertOnly: 0,
    expires: context.tokenTtlSeconds,
    returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize)}'
  });
  return putPolicy.uploadToken(context.mac);
}

function createProgressReporter(file) {
  let lastReported = -10;
  return (uploadedBytes, totalBytes) => {
    if (!totalBytes) {
      return;
    }
    const percentage = Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100));
    if (percentage === 100 || percentage >= lastReported + 10) {
      lastReported = percentage;
      console.log('[release]   ' + file.label + ': ' + percentage + '%');
    }
  };
}

function summarizeResponse(data) {
  if (data === undefined || data === null) {
    return '<empty response>';
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8').slice(0, 500);
  }
  if (typeof data === 'string') {
    return data.slice(0, 500);
  }
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return '<unserializable response>';
  }
}

async function uploadFile(file, context) {
  const uploadToken = createUploadToken(context, file.objectKey);
  const useResumeUpload = file.stat.size >= context.resumeThresholdBytes;
  let result;

  console.log(
    '[release] Uploading ' + file.label + ' with ' +
    (useResumeUpload ? 'resumable v2' : 'form upload') + '...'
  );

  if (useResumeUpload) {
    const uploader = new qiniu.resume_up.ResumeUploader(context.uploadConfig);
    const putExtra = qiniu.resume_up.PutExtra.create();
    putExtra.mimeType = file.contentType;
    putExtra.progressCallback = createProgressReporter(file);
    result = await uploader.putFileV2(
      uploadToken,
      file.objectKey,
      file.localPath,
      putExtra
    );
  } else {
    const uploader = new qiniu.form_up.FormUploader(context.uploadConfig);
    const putExtra = new qiniu.form_up.PutExtra();
    putExtra.mimeType = file.contentType;
    result = await uploader.putFile(
      uploadToken,
      file.objectKey,
      file.localPath,
      putExtra
    );
  }

  const statusCode = result && result.resp && result.resp.statusCode;
  if (statusCode !== 200) {
    throw new Error(
      'Qiniu upload failed for ' + file.objectKey +
      ' (HTTP ' + (statusCode || 'unknown') + '): ' +
      summarizeResponse(result && result.data)
    );
  }

  if (result.data && result.data.key && result.data.key !== file.objectKey) {
    throw new Error(
      'Qiniu returned an unexpected key for ' + file.objectKey +
      ': ' + result.data.key
    );
  }

  console.log(
    '[release] Uploaded ' + file.objectKey +
    (result.data && result.data.hash ? ' (' + result.data.hash + ')' : '')
  );
}

function postJson(urlValue, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const requestBody = JSON.stringify(body);
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(requestBody)
        }
      },
      (response) => {
        const chunks = [];
        let length = 0;

        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > 1024 * 1024) {
            request.destroy(new Error('Qiniu CDN response exceeded 1 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Qiniu CDN refresh timed out'));
    });
    request.on('error', reject);
    request.end(requestBody);
  });
}

async function refreshCdnCache(urls, context) {
  const endpointUrl = new URL(DEFAULT_REFRESH_ENDPOINT);

  const authorization = qiniu.util.generateAccessToken(
    context.mac,
    endpointUrl.toString(),
    ''
  );
  const response = await postJson(
    endpointUrl,
    { urls },
    {
      'Content-Type': 'application/json',
      Authorization: authorization
    },
    context.httpTimeoutMs
  );

  let responseBody;
  try {
    responseBody = response.body ? JSON.parse(response.body) : {};
  } catch {
    throw new Error(
      'Qiniu CDN refresh returned invalid JSON (HTTP ' +
      response.statusCode + '): ' + response.body.slice(0, 500)
    );
  }

  if (
    response.statusCode !== 200 ||
    Number(responseBody.code) !== 200 ||
    (Array.isArray(responseBody.invalidUrls) && responseBody.invalidUrls.length > 0)
  ) {
    throw new Error(
      'Qiniu CDN refresh failed (HTTP ' + response.statusCode + '): ' +
      summarizeResponse(responseBody)
    );
  }

  console.log(
    '[release] CDN refresh accepted' +
    (responseBody.requestId ? ', requestId=' + responseBody.requestId : '') +
    (responseBody.urlSurplusDay !== undefined
      ? ', remaining URL quota=' + responseBody.urlSurplusDay
      : '')
  );
  return responseBody;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const environment = loadEnvironment(PROJECT_ROOT, options);
  const plan = createReleasePlan(PROJECT_ROOT, environment);
  const refreshEnabled =
    !options.skipRefresh &&
    parseBoolean(
      environment.QINIU_REFRESH_CACHE,
      true,
      'QINIU_REFRESH_CACHE'
    );

  printReleasePlan(plan, environment, refreshEnabled, options.dryRun);
  if (options.dryRun) {
    console.log('[release] Dry run complete; no files uploaded');
    return;
  }

  const context = createUploadContext(environment);
  for (const file of plan.files) {
    await uploadFile(file, context);
  }

  if (refreshEnabled) {
    console.log('[release] Submitting CDN cache refresh...');
    await refreshCdnCache(
      plan.files.map((file) => file.cdnUrl),
      context
    );
  }

  console.log('[release] Release upload complete');
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[release] Failed: ' + error.message);
    if (process.env.RELEASE_DEBUG === 'true') {
      console.error(error.stack);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  buildCdnUrl,
  createReleasePlan,
  createUploadContext,
  createUploadToken,
  joinObjectKey,
  loadEnvironment,
  normalizeObjectName,
  parseArguments,
  parseBoolean,
  parseEnv,
  parseLatestYml,
  resolveUploadZone,
  stripYamlScalar
};
