#!/usr/bin/env node

import fs from 'fs';
import https from 'https';
import { execSync } from 'child_process';

const REPO_OWNER = 'mcKanses';
const REPO_NAME = 'missbetty';
const README_PATH = 'README.md';
const BRANCH_PREFIX = 'chore/update-readme-version';

async function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'Betty-CLI-Update-Script',
        'Accept': 'application/vnd.github.v3+json',
      },
    };

    // Add auth token if available
    if (process.env.GITHUB_TOKEN) {
      options.headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    https
      .get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Failed to fetch release: ${res.statusCode}`));
          }
        });
      })
      .on('error', reject);
  });
}

function updateReadme(version) {
  let content = fs.readFileSync(README_PATH, 'utf-8');

  // Update version pinning examples
  content = content.replace(
    /BETTY_VERSION=v[\d.]+/g,
    `BETTY_VERSION=${version}`
  );
  content = content.replace(
    /\$env:BETTY_VERSION = 'v[\d.]+'/g,
    `$env:BETTY_VERSION = '${version}'`
  );

  fs.writeFileSync(README_PATH, content);
  return content;
}

function hasChanges() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function commitAndPush(version) {
  const branchName = `${BRANCH_PREFIX}-${version}`;

  // Configure git
  execSync('git config user.name "github-actions"');
  execSync('git config user.email "github-actions@github.com"');

  // Check if branch exists, delete it if it does
  try {
    execSync(`git push origin --delete ${branchName}`, { stdio: 'pipe' });
  } catch {
    // Branch doesn't exist, that's fine
  }

  // Create and push branch
  execSync(`git checkout -b ${branchName}`);
  execSync('git add README.md');
  execSync(`git commit -m "docs: update version examples to ${version}"`);
  execSync(`git push origin ${branchName}`);

  return branchName;
}

function createPullRequest(version, branchName) {
  if (!process.env.GITHUB_TOKEN) {
    console.log('⚠️  GITHUB_TOKEN not set, skipping PR creation');
    return;
  }

  const body = {
    title: `docs: update version examples to ${version}`,
    head: branchName,
    base: 'main',
    body: `Automatically updates version pinning examples in README.md to reflect the latest release: ${version}`,
  };

  const options = {
    hostname: 'api.github.com',
    path: `/repos/${REPO_OWNER}/${REPO_NAME}/pulls`,
    method: 'POST',
    headers: {
      'User-Agent': 'Betty-CLI-Update-Script',
      'Authorization': `token ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 201) {
          const pr = JSON.parse(data);
          console.log(`✅ PR created: ${pr.html_url}`);
          resolve(pr);
        } else {
          // PR might already exist, that's okay
          console.log(`⚠️  PR creation returned ${res.statusCode}`);
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  try {
    console.log('📦 Fetching latest release...');
    const release = await fetchLatestRelease();
    const version = release.tag_name;

    console.log(`📝 Updating README.md to ${version}...`);
    updateReadme(version);

    if (!hasChanges()) {
      console.log('✅ No changes needed, README already up to date');
      process.exit(0);
    }

    console.log('🔄 Committing and pushing changes...');
    const branchName = commitAndPush(version);

    console.log('🔗 Creating pull request...');
    await createPullRequest(version, branchName);

    console.log('✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
