'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
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
  resolveUploadZone
} = require('../scripts/release-upload');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-release-upload-'));

try {
  assert.deepStrictEqual(
    parseArguments([
      '--dry-run',
      '--skip-refresh',
      '--env-file',
      'secrets.env'
    ]),
    {
      dryRun: true,
      skipRefresh: true,
      help: false,
      envFile: 'secrets.env'
    }
  );

  assert.deepStrictEqual(
    parseEnv([
      '# release credentials',
      'QINIU_BUCKET=release-bucket',
      'export QINIU_KEY_PREFIX="desktop/releases"',
      'VALUE_WITH_HASH=abc#123',
      'COMMENTED=value # comment'
    ].join('\n')),
    {
      QINIU_BUCKET: 'release-bucket',
      QINIU_KEY_PREFIX: 'desktop/releases',
      VALUE_WITH_HASH: 'abc#123',
      COMMENTED: 'value'
    }
  );

  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    [
      'QINIU_BUCKET=file-bucket',
      'QINIU_KEY_PREFIX=file-prefix'
    ].join('\n')
  );
  const mergedEnvironment = loadEnvironment(
    tempRoot,
    { envFile: null },
    { QINIU_BUCKET: 'system-bucket' }
  );
  assert.strictEqual(mergedEnvironment.QINIU_BUCKET, 'file-bucket');
  assert.strictEqual(mergedEnvironment.QINIU_KEY_PREFIX, 'file-prefix');

  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    'QINIU_BUCKET=\nQINIU_KEY_PREFIX=file-prefix\n'
  );
  const environmentWithEmptyFileValue = loadEnvironment(
    tempRoot,
    { envFile: null },
    { QINIU_BUCKET: 'system-bucket', QINIU_KEY_PREFIX: 'system-prefix' }
  );
  assert.strictEqual(environmentWithEmptyFileValue.QINIU_BUCKET, 'system-bucket');
  assert.strictEqual(environmentWithEmptyFileValue.QINIU_KEY_PREFIX, 'file-prefix');

  assert.strictEqual(parseBoolean('yes', false, 'FLAG'), true);
  assert.strictEqual(parseBoolean('off', true, 'FLAG'), false);
  assert.throws(() => parseBoolean('maybe', true, 'FLAG'), /FLAG/);
  assert.strictEqual(
    normalizeObjectName('folder\\installer.exe', 'test'),
    'folder/installer.exe'
  );
  assert.throws(
    () => normalizeObjectName('../secret', 'test'),
    /safe relative object name/
  );
  assert.strictEqual(
    joinObjectKey('/live2d-pet/', 'latest.yml'),
    'live2d-pet/latest.yml'
  );
  assert.strictEqual(
    buildCdnUrl(
      'https://cdn.example.com',
      'live2d-pet/release notes.md'
    ),
    'https://cdn.example.com/live2d-pet/release%20notes.md'
  );
  assert.deepStrictEqual(
    parseLatestYml([
      'version: 1.2.3',
      'path: Live2DCompanion-Setup-1.2.3.exe'
    ].join('\n')),
    {
      version: '1.2.3',
      path: 'Live2DCompanion-Setup-1.2.3.exe'
    }
  );
  assert.strictEqual(resolveUploadZone('auto'), null);
  assert.throws(() => resolveUploadZone('invalid'), /QINIU_REGION/);

  const uploadContext = createUploadContext({
    QINIU_ACCESS_KEY: 'test-access-key',
    QINIU_SECRET_KEY: 'test-secret-key',
    QINIU_BUCKET: 'release-bucket'
  });
  const uploadToken = createUploadToken(
    uploadContext,
    'desktop/releases/latest.yml'
  );
  const encodedPolicy = uploadToken.split(':')[2]
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const policy = JSON.parse(
    Buffer.from(encodedPolicy, 'base64').toString('utf8')
  );
  assert.strictEqual(
    policy.scope,
    'release-bucket:desktop/releases/latest.yml'
  );
  assert.strictEqual(policy.insertOnly, 0);

  fs.mkdirSync(path.join(tempRoot, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'release'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      productName: 'Fixture',
      version: '1.2.3'
    })
  );
  fs.writeFileSync(
    path.join(tempRoot, 'dist', 'latest.yml'),
    [
      'version: 1.2.3',
      'path: Fixture-Setup-1.2.3.exe'
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(tempRoot, 'dist', 'Fixture-Setup-1.2.3.exe'),
    'fixture exe'
  );
  fs.writeFileSync(
    path.join(tempRoot, 'release', 'release-notes-1.2.3.md'),
    '# Fixture release'
  );

  const plan = createReleasePlan(tempRoot, {
    QINIU_CDN_BASE_URL: 'https://cdn.example.com',
    QINIU_KEY_PREFIX: 'desktop/releases'
  });
  assert.strictEqual(plan.version, '1.2.3');
  assert.deepStrictEqual(
    plan.files.map((file) => file.objectKey),
    [
      'desktop/releases/Fixture-Setup-1.2.3.exe',
      'desktop/releases/release-notes-1.2.3.md',
      'desktop/releases/latest.yml'
    ]
  );
  assert.strictEqual(
    plan.files[2].cdnUrl,
    'https://cdn.example.com/desktop/releases/latest.yml'
  );

  fs.writeFileSync(
    path.join(tempRoot, 'dist', 'latest.yml'),
    [
      'version: 9.9.9',
      'path: Fixture-Setup-1.2.3.exe'
    ].join('\n')
  );
  assert.throws(
    () => createReleasePlan(tempRoot, {}),
    /does not match package.json version/
  );

  console.log('release upload QA passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
