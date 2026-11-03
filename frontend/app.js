const $ = (selector) => document.querySelector(selector);
const list = $('#problem-list');
const template = $('#problem-template');
let problems = [];
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
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
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
  $('#account-status').textContent = signedIn ? `${currentUser.name} · ${currentUser.role_name}` : 'Not signed in';
  $('#new-button').hidden = !(signedIn && currentUser.role_category === 'Organizer');
  $('#show-inactive').disabled = !signedIn;
}
function openForm(problem = null) {
  $('#problem-form').reset();
  $('#form-error').textContent = '';
  $('#problem-id').value = problem?.problem_id ?? '';
  $('#form-title').textContent = problem ? `Edit problem #${problem.problem_id}` : 'Create a problem';
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
function render() {
  const term = $('#search').value.trim().toLowerCase();
  const difficulty = $('#difficulty-filter').value;
  const filtered = problems.filter(p =>
    (!term || p.title.toLowerCase().includes(term)) &&
    (!difficulty || p.difficulty === difficulty)
  );
  $('#count').textContent = filtered.length;
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching problems found.'; list.append(empty); return;
  }
  for (const p of filtered) {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector('.problem-row');
    row.querySelector('.problem-id').textContent = `#${p.problem_id}`;
    row.querySelector('.problem-title').textContent = p.title;
    row.querySelector('.difficulty').textContent = p.difficulty;
    row.querySelector('.difficulty').dataset.level = p.difficulty.toLowerCase();
    row.querySelector('.problem-description').textContent = p.problem_statement || 'No statement has been added yet.';
    row.querySelector('.problem-meta').textContent = `Created ${new Date(p.created_at).toLocaleDateString()} · Organizer ID ${p.created_by}`;
    row.querySelector('.retired-tag').hidden = p.is_active;
    const canManage = currentUser?.role_category === 'Organizer';
    row.querySelector('.edit-button').hidden = !canManage;
    row.querySelector('.retire-button').hidden = !canManage || !p.is_active;
    row.querySelector('.edit-button').addEventListener('click', () => openForm(p));
    row.querySelector('.retire-button').addEventListener('click', async () => {
      if (!confirm(`Retire “${p.title}”? Existing submissions and related records will be preserved.`)) return;
      try {
        await api(`/api/problems/${p.problem_id}/retire`, { method: 'PATCH' });
        notify(`Problem #${p.problem_id} retired; history preserved.`, 'success');
        await loadProblems();
      } catch (error) { notify(error.message, 'error'); }
    });
    list.append(fragment);
  }
}
async function loadProblems() {
  list.innerHTML = '<p class="empty">Loading problems…</p>';
  try {
    const query = $('#show-inactive').checked && currentUser ? '?includeInactive=true' : '';
    const payload = await api('/api/problems' + query);
    problems = payload.problems;
    render();
  } catch (error) { list.textContent = error.message; notify(error.message, 'error'); }
}
async function loadCurrentUser() {
  try {
    const payload = await api('/api/auth/me');
    currentUser = payload.user;
  } catch { currentUser = null; }
  updateAccountUI();
}
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-button').disabled = true;
  $('#login-error').textContent = '';
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value })
    });
    currentUser = result.user;
    $('#login-password').value = '';
    updateAccountUI();
    notify(result.passwordUpgraded ? 'Signed in. Legacy password hash upgraded to Argon2id.' : 'Signed in successfully.', 'success');
    await loadProblems();
  } catch (error) { $('#login-error').textContent = error.message; }
  finally { $('#login-button').disabled = false; }
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
  } catch (error) { notify(error.message, 'error'); }
});
$('#new-button').addEventListener('click', () => openForm());
$('#cancel-button').addEventListener('click', () => { $('#form-panel').hidden = true; });
$('#search').addEventListener('input', render);
$('#difficulty-filter').addEventListener('change', render);
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
    const result = await api(id ? `/api/problems/${id}` : '/api/problems', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(body)
    });
    $('#form-panel').hidden = true;
    notify(id ? `Problem #${id} updated.` : `Problem #${result.problem.problem_id} created.`, 'success');
    await loadProblems();
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#save-button').disabled = false; }
});
(async () => { await loadCurrentUser(); await loadProblems(); })();
