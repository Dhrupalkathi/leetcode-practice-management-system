const DEFAULT_BASE_URL = 'https://ce.judge0.com';
let cachedLanguages = null;
let cacheExpiresAt = 0;

function judge0BaseUrl() {
  return String(process.env.JUDGE0_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function judge0Headers() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.JUDGE0_AUTH_TOKEN) {
    headers['X-Auth-Token'] = process.env.JUDGE0_AUTH_TOKEN;
  }
  return headers;
}

async function readJson(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : operation + ' failed.';
    throw new Error(message);
  }
  return payload;
}

async function getProviderLanguages() {
  if (cachedLanguages && Date.now() < cacheExpiresAt) return cachedLanguages;
  const response = await fetch(judge0BaseUrl() + '/languages', {
    method: 'GET',
    headers: judge0Headers(),
    signal: AbortSignal.timeout(12000)
  });
  const payload = await readJson(response, 'Judge0 language catalogue');
  if (!Array.isArray(payload)) throw new Error('Judge0 returned an invalid language catalogue.');
  cachedLanguages = payload;
  cacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return cachedLanguages;
}

async function listAvailableLanguages(pool) {
  const [dbResult, providerLanguages] = await Promise.all([
    pool.query(
      `SELECT language_id, name, version, judge0_language_name, judge0_compile_options
       FROM public.language
       WHERE judge0_language_name IS NOT NULL
       ORDER BY name, version`
    ),
    getProviderLanguages()
  ]);

  const providerByName = new Map(providerLanguages.map((item) => [item.name, item]));
  return dbResult.rows
    .filter((language) => providerByName.has(language.judge0_language_name))
    .map((language) => {
      const provider = providerByName.get(language.judge0_language_name);
      return {
        language_id: language.language_id,
        name: language.name,
        version: language.version,
        label: language.name + ' ' + language.version,
        judge0_language_id: provider.id
      };
    });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function executeTestCase({ sourceCode, language, testCase }) {
  const baseUrl = judge0BaseUrl();
  const body = {
    source_code: sourceCode,
    language_id: language.judge0_language_id,
    stdin: testCase.input_data,
    expected_output: testCase.expected_output,
    cpu_time_limit: Number(process.env.JUDGE0_CPU_TIME_LIMIT || 2),
    cpu_extra_time: Number(process.env.JUDGE0_CPU_EXTRA_TIME || 1),
    wall_time_limit: Number(process.env.JUDGE0_WALL_TIME_LIMIT || 10),
    memory_limit: Number(process.env.JUDGE0_MEMORY_LIMIT_KB || 131072)
  };
  if (language.judge0_compile_options) body.compiler_options = language.judge0_compile_options;

  const createResponse = await fetch(baseUrl + '/submissions?base64_encoded=false&wait=false', {
    method: 'POST',
    headers: judge0Headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const created = await readJson(createResponse, 'Judge0 submission creation');
  if (!created.token) throw new Error('Judge0 did not return a submission token.');

  const attempts = Number(process.env.JUDGE0_MAX_POLL_ATTEMPTS || 60);
  const interval = Number(process.env.JUDGE0_POLL_INTERVAL_MS || 500);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delay(interval);
    const pollResponse = await fetch(
      baseUrl + '/submissions/' + encodeURIComponent(created.token) +
        '?base64_encoded=false&fields=*',
      {
        method: 'GET',
        headers: judge0Headers(),
        signal: AbortSignal.timeout(15000)
      }
    );
    const result = await readJson(pollResponse, 'Judge0 result polling');
    const statusId = Number(result.status?.id || 0);
    if (statusId >= 3) return result;
  }
  throw new Error('Judge0 execution timed out while waiting for a result.');
}

module.exports = { listAvailableLanguages, executeTestCase };
