const REPO_OWNER = process.env.GITHUB_OWNER || 'jjshay';
const REPO_NAME = process.env.GITHUB_REPO || 'ai-book';
const FILE_PATH = 'companies.json';
const API_BASE = 'https://api.github.com';

function getHeaders() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }
  return {
    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

async function fetchCompaniesJson() {
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  const res = await fetch(url, { headers: getHeaders() });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

async function updateCompaniesJson(companies, changes) {
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

  // Get current file SHA (needed for updates)
  const getRes = await fetch(url, { headers: getHeaders() });
  if (!getRes.ok) {
    throw new Error(`GitHub API error: ${getRes.status} ${getRes.statusText}`);
  }
  const currentFile = await getRes.json();

  const content = JSON.stringify(companies, null, 2);
  const encodedContent = Buffer.from(content).toString('base64');

  const changesSummary = changes.map(c => `${c.action}: ${c.company}`).join(', ');
  const date = new Date().toISOString().split('T')[0];

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({
      message: `auto-update: ${date} - ${changes.length} changes\n\n${changesSummary}`,
      content: encodedContent,
      sha: currentFile.sha,
    }),
  });

  if (!putRes.ok) {
    const errBody = await putRes.text();
    throw new Error(`GitHub API update error: ${putRes.status} - ${errBody}`);
  }

  console.log(`[GitHub] Pushed update with ${changes.length} changes`);
}

async function getUpdateHistory() {
  const url = `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${FILE_PATH}&per_page=20`;
  const res = await fetch(url, { headers: getHeaders() });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const commits = await res.json();

  return commits
    .filter(c => c.commit.message.startsWith('auto-update:'))
    .map(c => ({
      date: c.commit.author.date,
      message: c.commit.message,
      sha: c.sha.substring(0, 7),
    }));
}

module.exports = { fetchCompaniesJson, updateCompaniesJson, getUpdateHistory };
