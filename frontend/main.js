const $ = (selector) => document.querySelector(selector);
const list = $('#problem-list');
const template = $('#problem-template');
let problems = [];
let topics = [];
let currentUser = null;
let currentProblemId = null;
let availableLanguages = null;

function notify(message, type = '') {
  const node = $('#notice');
  node.textContent = message;
  node.dataset.state = type;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload.details ? ' ' + payload.details.join('; ') : '';
    throw new Error((payload.error || 'Request failed.') + details);
  }
  return payload;
}

function updateAccountUI() {
  const signedIn = Boolean(currentUser);
  $('#login-panel').hidden = signedIn;
  $('#logout-button').hidden = !signedIn;
  $('#account-status').textContent = signedIn
    ? currentUser.name + ' · ' + currentUser.role_name
    : 'Not signed in';
  $('#new-button').hidden = !(signedIn && currentUser.role_category === 'Organizer');
  $('#show-inactive').disabled = !signedIn;
}

function addTopicChips(container, assignedTopics) {
  container.replaceChildren();
  if (!assignedTopics || assignedTopics.length === 0) {
    const none = document.createElement('span');
    none.className = 'muted';
    none.textContent = 'No topics assigned';
    container.append(none);
    return;
  }
  for (const topic of assignedTopics) {
    const chip = document.createElement('span');
    chip.className = 'topic-chip';
    chip.textContent = topic.name;
    container.append(chip);
  }
}

function render() {
  const term = $('#search').value.trim().toLocaleLowerCase();
  const difficulty = $('#difficulty-filter').value;
  const topicId = $('#topic-filter').value;

  const filtered = problems.filter((problem) => {
    const matchesText = !term || problem.title.toLocaleLowerCase().includes(term);
    const matchesDifficulty = !difficulty || problem.difficulty === difficulty;
    const matchesTopic = !topicId ||
      (problem.topics || []).some((topic) => String(topic.topic_id) === topicId);
    return matchesText && matchesDifficulty && matchesTopic;
  });

  $('#count').textContent = filtered.length;
  list.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching problems found.';
    list.append(empty);
    return;
  }

  for (const problem of filtered) {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector('.problem-row');
    row.querySelector('.problem-id').textContent = '#' + problem.problem_id;
    row.querySelector('.problem-title').textContent = problem.title;
    const level = row.querySelector('.difficulty');
    level.textContent = problem.difficulty;
    level.dataset.level = problem.difficulty.toLowerCase();
    row.querySelector('.problem-description').textContent =
      problem.problem_statement || 'Open this problem to view its full details.';
    row.querySelector('.problem-meta').textContent =
      'Created ' + new Date(problem.created_at).toLocaleDateString() +
      ' · Organizer ID ' + problem.created_by;
    row.querySelector('.retired-tag').hidden = problem.is_active;
    addTopicChips(row.querySelector('.problem-topics'), problem.topics);

    const canManage = currentUser?.role_category === 'Organizer';
    row.querySelector('.edit-button').hidden = !canManage;
    row.querySelector('.retire-button').hidden = !canManage || !problem.is_active;

    row.querySelector('.view-button').addEventListener('click', () => {
      openProblemDetails(problem.problem_id);
    });
    row.querySelector('.edit-button').addEventListener('click', () => openForm(problem));
    row.querySelector('.retire-button').addEventListener('click', async () => {
      if (!confirm('Retire "' + problem.title + '"? Existing submissions and related records will be preserved.')) return;
      try {
        await api('/api/problems/' + problem.problem_id + '/retire', { method: 'PATCH' });
        notify('Problem #' + problem.problem_id + ' retired; history preserved.', 'success');
        await loadProblems();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
    list.append(fragment);
  }
}

async function loadTopics() {
  const payload = await api('/api/topics');
  topics = payload.topics || [];
  const select = $('#topic-filter');
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All topics';
  select.append(all);
  for (const topic of topics) {
    const option = document.createElement('option');
    option.value = topic.topic_id;
    option.textContent = topic.name;
    select.append(option);
  }
}

async function loadProblems() {
  list.innerHTML = '<p class="empty">Loading problems…</p>';
  try {
    const query = $('#show-inactive').checked && currentUser ? '?includeInactive=true' : '';
    const payload = await api('/api/problems' + query);
    problems = payload.problems || [];
    render();
  } catch (error) {
    list.textContent = error.message;
    notify(error.message, 'error');
  }
}

async function loadCurrentUser() {
  try {
    const payload = await api('/api/auth/me');
    currentUser = payload.user;
  } catch {
    currentUser = null;
  }
  updateAccountUI();
}

function openForm(problem = null) {
  $('#problem-form').reset();
  $('#form-error').textContent = '';
  $('#problem-id').value = problem?.problem_id ?? '';
  $('#form-title').textContent = problem ? 'Edit problem #' + problem.problem_id : 'Create a problem';
  $('#title').value = problem?.title ?? '';
  $('#difficulty').value = problem?.difficulty ?? 'Easy';
  $('#problem-statement').value = problem?.problem_statement ?? '';
  $('#input-format').value = problem?.input_format ?? '';
  $('#output-format').value = problem?.output_format ?? '';
  $('#constraints').value = problem?.constraints ?? '';
  $('#form-panel').hidden = false;
  $('#title').focus();
  $('#form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addDetailField(container, label, value) {
  const section = document.createElement('section');
  section.className = 'detail-field';
  const heading = document.createElement('h3');
  heading.textContent = label;
  const content = document.createElement('p');
  content.textContent = value || 'Not provided.';
  section.append(heading, content);
  container.append(section);
}

function addSampleBlock(container, label, value) {
  const block = document.createElement('div');
  block.className = 'sample-block';
  const heading = document.createElement('h4');
  heading.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = value || '(empty)';
  block.append(heading, pre);
  container.append(block);
}

async function openProblemDetails(problemId) {
  try {
    const payload = await api('/api/problems/' + problemId);
    const problem = payload.problem;
    $('#detail-title').textContent = problem.title;
    const level = $('#detail-difficulty');
    level.textContent = problem.difficulty;
    level.dataset.level = problem.difficulty.toLowerCase();
    $('#detail-id').textContent = 'Problem #' + problem.problem_id;
    $('#detail-fields').replaceChildren();
    addDetailField($('#detail-fields'), 'Problem statement', problem.problem_statement);
    addDetailField($('#detail-fields'), 'Input format', problem.input_format);
    addDetailField($('#detail-fields'), 'Output format', problem.output_format);
    addDetailField($('#detail-fields'), 'Constraints', problem.constraints);

    addTopicChips($('#detail-topics'), problem.topics);
    const tests = $('#detail-samples');
    tests.replaceChildren();
    if (!problem.sample_tests || problem.sample_tests.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No public sample test cases have been added yet.';
      tests.append(empty);
    } else {
      for (const sample of problem.sample_tests) {
        const card = document.createElement('article');
        card.className = 'sample-card';
        const heading = document.createElement('h3');
        heading.textContent = 'Sample test case ' + sample.test_case_id;
        card.append(heading);
        addSampleBlock(card, 'Input', sample.input_data);
        addSampleBlock(card, 'Expected output', sample.expected_output);
        tests.append(card);
      }
    }

    await setupSubmissionWorkspace(problemId);

    const dialog = $('#problem-dialog');
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canSubmitCode() {
  return Boolean(currentUser && ['Learner', 'Organizer', 'Admin'].includes(currentUser.role_category));
}

async function loadAvailableLanguages() {
  if (Array.isArray(availableLanguages)) return availableLanguages;
  const payload = await api('/api/languages');
  availableLanguages = payload.languages || [];
  const select = $('#submission-language');
  select.replaceChildren();
  for (const language of availableLanguages) {
    const option = document.createElement('option');
    option.value = language.language_id;
    option.textContent = language.label;
    select.append(option);
  }
  if (!availableLanguages.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No matching Judge0 languages are available';
    select.append(option);
  }
  return availableLanguages;
}

function renderTestResults(container, testResults) {
  container.replaceChildren();
  if (!testResults || !testResults.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No individual test result is available yet.';
    container.append(empty);
    return;
  }
  for (const result of testResults) {
    const row = document.createElement('article');
    row.className = 'test-result-row';
    const heading = document.createElement('strong');
    heading.textContent = 'Test ' + result.test_case_number + ' · ' + result.status.replaceAll('_', ' ');
    const metrics = document.createElement('p');
    metrics.textContent = result.time_taken_ms + ' ms · ' + result.memory_used_kb + ' KB';
    row.append(heading, metrics);
    if (result.error_message) {
      const error = document.createElement('pre');
      error.className = 'execution-error';
      error.textContent = result.error_message;
      row.append(error);
    }
    container.append(row);
  }
}

function showSubmissionRecord(payload) {
  const submission = payload.submission;
  $('#submission-record').hidden = false;
  $('#submission-record-heading').textContent = 'Submission #' + submission.submission_id +
    (submission.is_run_only ? ' · Sample run' : ' · Attempt ' + submission.attempt_number);
  $('#submission-record-code').textContent = submission.code || '';
  $('#submission-record-verdict').textContent = submission.verdict_name || submission.execution_status;
  $('#submission-record-metrics').textContent = submission.time_taken_ms + ' ms total · ' +
    submission.memory_used_kb + ' KB peak';
  $('#submission-record-error').textContent = submission.execution_error || '';
  renderTestResults($('#submission-record-tests'), payload.test_results);
}

async function loadSubmissionHistory(problemId) {
  const history = $('#problem-submissions');
  history.replaceChildren();
  if (!canSubmitCode()) return;
  try {
    const payload = await api('/api/submissions?problemId=' + encodeURIComponent(problemId));
    if (!payload.submissions || !payload.submissions.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No submissions for this problem yet.';
      history.append(empty);
      return;
    }
    for (const submission of payload.submissions) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const summary = document.createElement('span');
      const action = submission.is_run_only ? 'Sample run' : 'Submission · Attempt ' + submission.attempt_number;
      summary.textContent = '#' + submission.submission_id + ' · ' + action + ' · ' +
        (submission.verdict_name || submission.execution_status);
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'secondary';
      view.textContent = 'Details';
      view.addEventListener('click', async () => {
        try {
          const detail = await api('/api/submissions/' + submission.submission_id);
          showSubmissionRecord(detail);
        } catch (error) {
          $('#submission-status').textContent = error.message;
        }
      });
      row.append(summary, view);
      history.append(row);
    }
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = error.message;
    history.append(message);
  }
}

async function refreshSubmission(problemId, submissionId, action) {
  $('#submission-status').textContent = 'Queued. Waiting for the isolated execution service…';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await api('/api/submissions/' + submissionId);
    const item = payload.submission;
    if (item.execution_status === 'COMPLETED' || item.execution_status === 'FAILED') {
      showSubmissionRecord(payload);
      const prefix = action === 'run' ? 'Sample run' : 'Submission';
      $('#submission-status').textContent = item.execution_status === 'FAILED'
        ? prefix + ' could not be completed. ' + (item.execution_error || 'Please retry.')
        : prefix + ' finished: ' + (item.verdict_name || 'Completed') + '.';
      await loadSubmissionHistory(problemId);
      return;
    }
    $('#submission-status').textContent = item.execution_status === 'RUNNING'
      ? 'Code is running in the isolated judge…' : 'Queued…';
    await wait(800);
  }
  $('#submission-status').textContent = 'This execution is taking longer than the page wait window. Its status is saved; refresh the submission history to check again.';
  await loadSubmissionHistory(problemId);
}

async function runOrSubmitCode(action) {
  if (!currentProblemId || !canSubmitCode()) return;
  const code = $('#source-code').value;
  const languageId = Number($('#submission-language').value);
  if (!code.trim()) { $('#submission-status').textContent = 'Enter your code first.'; return; }
  if (!Number.isSafeInteger(languageId) || languageId <= 0) {
    $('#submission-status').textContent = 'Select an available programming language.';
    return;
  }
  const runButton = $('#run-samples');
  const submitButton = $('#submit-code');
  runButton.disabled = true;
  submitButton.disabled = true;
  $('#submission-record').hidden = true;
  $('#submission-status').textContent = 'Sending code to the isolated execution service…';
  try {
    const created = await api('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({ problem_id: currentProblemId, language_id: languageId, code, action })
    });
    $('#submission-status').textContent = 'Execution queued as #' + created.submission_id + '.';
    await refreshSubmission(currentProblemId, created.submission_id, action);
  } catch (error) {
    $('#submission-status').textContent = error.message;
  } finally {
    runButton.disabled = false;
    submitButton.disabled = false;
  }
}

async function setupSubmissionWorkspace(problemId) {
  currentProblemId = problemId;
  const workspace = $('#submission-workspace');
  workspace.hidden = !canSubmitCode();
  $('#submission-record').hidden = true;
  $('#submission-status').textContent = '';
  if (!canSubmitCode()) return;
  try {
    const languages = await loadAvailableLanguages();
    const ready = languages.length > 0;
    $('#run-samples').disabled = !ready;
    $('#submit-code').disabled = !ready;
    $('#submission-language').disabled = !ready;
    $('#language-help').textContent = ready
      ? 'Only language versions available on the configured Judge0 instance are listed.'
      : 'No seeded language version currently matches the execution provider.';
  } catch (error) {
    $('#run-samples').disabled = true;
    $('#submit-code').disabled = true;
    $('#submission-language').disabled = true;
    $('#language-help').textContent = 'Could not reach the execution provider. Submission controls are disabled until it is available.';
    $('#submission-status').textContent = error.message;
  }
  await loadSubmissionHistory(problemId);
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-button').disabled = true;
  $('#login-error').textContent = '';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#login-email').value,
        password: $('#login-password').value
      })
    });
    currentUser = result.user;
    $('#login-password').value = '';
    updateAccountUI();
    notify(
      result.passwordUpgraded
        ? 'Signed in. Legacy password hash upgraded to Argon2id.'
        : 'Signed in successfully.',
      'success'
    );
    await loadProblems();
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally {
    $('#login-button').disabled = false;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    $('#form-panel').hidden = true;
    $('#show-inactive').checked = false;
    updateAccountUI();
    notify('You have been logged out.', 'success');
    await loadProblems();
  } catch (error) {
    notify(error.message, 'error');
  }
});

$('#new-button').addEventListener('click', () => openForm());
$('#cancel-button').addEventListener('click', () => { $('#form-panel').hidden = true; });
$('#detail-close').addEventListener('click', () => $('#problem-dialog').close());
$('#run-samples').addEventListener('click', () => runOrSubmitCode('run'));
$('#submit-code').addEventListener('click', () => runOrSubmitCode('submit'));
$('#search').addEventListener('input', render);
$('#difficulty-filter').addEventListener('change', render);
$('#topic-filter').addEventListener('change', render);
$('#show-inactive').addEventListener('change', loadProblems);

$('#problem-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#problem-id').value;
  const body = {
    title: $('#title').value,
    difficulty: $('#difficulty').value,
    problem_statement: $('#problem-statement').value,
    input_format: $('#input-format').value,
    output_format: $('#output-format').value,
    constraints: $('#constraints').value
  };
  $('#save-button').disabled = true;
  $('#form-error').textContent = '';
  try {
    const result = await api(id ? '/api/problems/' + id : '/api/problems', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    $('#form-panel').hidden = true;
    notify(
      id ? 'Problem #' + id + ' updated.' : 'Problem #' + result.problem.problem_id + ' created.',
      'success'
    );
    await loadProblems();
  } catch (error) {
    $('#form-error').textContent = error.message;
  } finally {
    $('#save-button').disabled = false;
  }
});

(async () => {
  await loadCurrentUser();
  await loadTopics();
  await loadProblems();
})();
