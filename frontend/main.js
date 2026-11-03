const $ = (selector) => document.querySelector(selector);
const list = $('#problem-list');
const template = $('#problem-template');
let problems = [];
let topics = [];
let currentUser = null;

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

    const dialog = $('#problem-dialog');
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    notify(error.message, 'error');
  }
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
