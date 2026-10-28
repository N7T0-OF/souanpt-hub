import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDistribution, validateDistribution } from '../scripts/prepare-deploy.mjs';

for (const channel of ['github-pages', 'cloudflare']) {
  test(`${channel} artifact is allowlisted, complete, and carries its source SHA`, t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'souanpt-artifact-test-'));
    const output = path.join(parent, channel);
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const result = buildDistribution({ channel, output, commitSha: 'a'.repeat(40), builtAt: '2026-10-21T00:00:00.000Z' });
    assert.equal(result.commit, 'a'.repeat(40));
    assert.equal(result.version, '3.12.1');
    assert.equal(validateDistribution(output, channel).info.channel, channel);
    assert.equal(fs.existsSync(path.join(output, 'docs')), false);
    assert.equal(fs.existsSync(path.join(output, 'README.md')), false);
    assert.equal(fs.existsSync(path.join(output, '.freebuff')), false);
    assert.equal(fs.existsSync(path.join(output, 'functions')), channel === 'cloudflare');
  });
}
