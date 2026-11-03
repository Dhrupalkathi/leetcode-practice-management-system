const $ = (selector) => document.querySelector(selector);
let invitationToken = '';
let assessmentData = null;
let currentProblemId = null;
let currentProblems = [];
let languages = null;
let remainingSeconds = 0;
let timerHandle = null;

function setNotice(message, error = false) {
  const node = $('#candidate-notice');
  node.textContent = message;
  node.dataset.state = error ? 'error' : '';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + invitationToken,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTimer(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function startTimer(seconds) {
  stopTimer();
  remainingSeconds = Math.max(0, Number(seconds) || 0);
  $('#candidate-timer').textContent = formatTimer(remainingSeconds);
  $('#candidate-timer-panel').hidden = false;
  timerHandle = setInterval(async () => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    $('#candidate-timer').textContent = formatTimer(remainingSeconds);
    if (remainingSeconds === 0) {
      stopTimer();
      setNotice('Your time limit has ended. The assessment is being finalized.');
      await refreshCandidateState();
    }
  }, 1000);
}

function renderSamples(samples) {
  const container = $('#candidate-problem-spec');
  container.replaceChildren();
  for (const [label, value] of [
    ['Problem statement', activeProblem.problem_statement],
    ['Input format', activeProblem.input_format],
    ['Output format', activeProblem.output_format],
    ['Constraints', activeProblem.constraints]
  ]) {
    const section = document.createElement('section');
    section.className = 'detail-field';
    const title = document.createElement('h3'); title.textContent = label;
    const body = document.createElement('p'); body.textContent = value || 'Not provided.';
    section.append(title, body); container.append(section);
  }
  const sampleHeading = document.createElement('h3');
  sampleHeading.className = 'sample-heading';
  sampleHeading.textContent = 'Public sample cases';
  container.append(sampleHeading);
  if (!samples.length) {
    const empty = document.createElement('p'); empty.className = 'muted';
    empty.textContent = 'No public sample cases are configured for this problem.';
    container.append(empty);
  }
  for (const sample of samples) {
    const card = document.createElement('article'); card.className = 'sample-card';
    const heading = document.createElement('h4'); heading.textContent = 'Sample ' + sample.test_case_id;
    card.append(heading);
    for (const [label, value] of [['Input', sample.input_data], ['Expected output', sample.expected_output]]) {
      const block = document.createElement('div'); block.className = 'sample-block';
      const blockTitle = document.createElement('h5'); blockTitle.textContent = label;
      const pre = document.createElement('pre'); pre.textContent = value || '(empty)';
      block.append(blockTitle, pre); card.append(block);
    }
    container.append(card);
  }
}

let activeProblem = null;

function renderProblemList() {
  const container = $('#candidate-problem-list'); container.replaceChildren();
  $('#candidate-problem-count').textContent = currentProblems.length;
  for (const problem of currentProblems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'candidate-problem-button' + (Number(problem.problem_id) === Number(currentProblemId) ? ' active' : '');
    const title = document.createElement('strong'); title.textContent = problem.order_no + '. ' + problem.title;
    const difficulty = document.createElement('span'); difficulty.textContent = problem.difficulty;
    button.append(title, difficulty);
    button.addEventListener('click', () => openCandidateProblem(problem.problem_id));
    container.append(button);
  }
}

async function loadLanguages() {
  if (Array.isArray(languages)) return languages;
  const payload = await api('/api/candidate-assessment/languages');
  languages = payload.languages || [];
  const select = $('#candidate-language'); select.replaceChildren();
  for (const language of languages) {
    const option = document.createElement('option');
    option.value = language.language_id; option.textContent = language.label; select.append(option);
  }
  if (!languages.length) {
    const option = document.createElement('option'); option.value = '';
    option.textContent = 'No supported language versions'; select.append(option);
  }
  return languages;
}

async function openCandidateProblem(problemId) {
  try {
    const payload = await api('/api/candidate-assessment/problems/' + problemId);
    activeProblem = payload.problem; currentProblemId = problemId;
    $('#candidate-problem-id').textContent = 'ASSESSMENT PROBLEM #' + problemId;
    $('#candidate-problem-title').textContent = activeProblem.title;
    const difficulty = $('#candidate-problem-difficulty');
    difficulty.hidden = false; difficulty.textContent = activeProblem.difficulty;
    difficulty.dataset.level = activeProblem.difficulty.toLowerCase();
    renderSamples(activeProblem.sample_tests || []);
    $('#candidate-code-area').hidden = false;
    renderProblemList();
    await loadLanguages();
    await loadSubmissionHistory(problemId);
  } catch(error) { setNotice(error.message,true); }
}

function renderTestResults(results) {
  const container=$('#candidate-result-tests');container.replaceChildren();
  if(!results.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No individual test results are available yet.';container.append(empty);return;}
  for(const result of results){
    const row=document.createElement('article');row.className='test-result-row';
    const heading=document.createElement('strong');heading.textContent='Test '+result.test_case_number+' · '+result.status.replaceAll('_',' ');
    const metrics=document.createElement('p');metrics.textContent=result.time_taken_ms+' ms · '+result.memory_used_kb+' KB';
    row.append(heading,metrics);
    if(result.error_message){const error=document.createElement('pre');error.className='execution-error';error.textContent=result.error_message;row.append(error);}
    container.append(row);
  }
}

function showSubmission(payload) {
  const s=payload.submission;
  $('#candidate-result').hidden=false;
  $('#candidate-result-heading').textContent='Attempt '+s.attempt_number+' · Submission #'+s.submission_id;
  $('#candidate-result-verdict').textContent=s.verdict_name||s.execution_status;
  $('#candidate-result-metrics').textContent=s.time_taken_ms+' ms · '+s.memory_used_kb+' KB peak';
  $('#candidate-result-error').textContent=s.execution_error||'';
  $('#candidate-result-code').textContent=s.code||'';
  renderTestResults(payload.test_results||[]);
}

async function loadSubmissionHistory(problemId) {
  const container=$('#candidate-submission-history');container.replaceChildren();
  const payload=await api('/api/candidate-assessment/submissions');
  const rows=(payload.submissions||[]).filter((item)=>Number(item.problem_id)===Number(problemId));
  if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No attempts for this problem yet.';container.append(empty);return;}
  for(const item of rows){
    const row=document.createElement('div');row.className='history-row';
    const label=document.createElement('span');label.textContent='Attempt '+item.attempt_number+' · '+(item.verdict_name||item.execution_status);
    const details=document.createElement('button');details.type='button';details.className='secondary';details.textContent='Details';
    details.addEventListener('click',async()=>{
      try{const detail=await api('/api/candidate-assessment/submissions/'+item.submission_id);showSubmission(detail);}
      catch(error){$('#candidate-execution-status').textContent=error.message;}
    });
    row.append(label,details);container.append(row);
  }
}

async function pollSubmission(submissionId,action) {
  $('#candidate-execution-status').textContent='Waiting for the isolated judge…';
  for(let attempt=0;attempt<90;attempt+=1){
    const payload=await api('/api/candidate-assessment/submissions/'+submissionId);
    const s=payload.submission;
    if(s.execution_status==='COMPLETED'||s.execution_status==='FAILED'){
      showSubmission(payload);
      $('#candidate-execution-status').textContent=(action==='run'?'Sample run':'Submission')+' finished: '+(s.verdict_name||s.execution_status)+'.';
      await loadSubmissionHistory(currentProblemId);
      return;
    }
    $('#candidate-execution-status').textContent=s.execution_status==='RUNNING'?'Code is running in the isolated judge…':'Queued…';
    await new Promise(resolve=>setTimeout(resolve,800));
  }
  $('#candidate-execution-status').textContent='Execution is still processing. Your attempt is saved; check its status in your history.';
}

async function submitCode(action) {
  if(!currentProblemId||!assessmentData||assessmentData.status!=='Started')return;
  const code=$('#candidate-source-code').value;
  const languageId=Number($('#candidate-language').value);
  if(!code.trim()){ $('#candidate-execution-status').textContent='Enter your code first.';return;}
  if(!Number.isSafeInteger(languageId)||languageId<=0){ $('#candidate-execution-status').textContent='Select an available language.';return;}
  $('#candidate-run').disabled=true;$('#candidate-submit').disabled=true;$('#candidate-result').hidden=true;
  try{
    const result=await api('/api/candidate-assessment/submissions',{
      method:'POST',body:JSON.stringify({problem_id:currentProblemId,language_id:languageId,code,action})
    });
    await pollSubmission(result.submission_id,action);
  }catch(error){$('#candidate-execution-status').textContent=error.message;}
  finally{
    const enabled=assessmentData?.status==='Started'&&remainingSeconds>0;
    $('#candidate-run').disabled=!enabled;$('#candidate-submit').disabled=!enabled;
  }
}

async function loadProblems() {
  const payload=await api('/api/candidate-assessment/problems');
  currentProblems=payload.problems||[];
  renderProblemList();
  if(currentProblems.length) await openCandidateProblem(currentProblems[0].problem_id);
}

async function renderAssessmentState(me) {
  assessmentData=me;
  $('#assessment-title').textContent=me.assessment.title;
  $('#assessment-description').textContent=me.assessment.description||'Complete the assigned coding problems within the time window.';
  $('#candidate-name').textContent='Candidate: '+me.candidate.name;
  $('#assessment-schedule').textContent=formatDate(me.assessment.start_time)+' — '+formatDate(me.assessment.end_time);
  $('#assessment-limit').textContent=me.assessment.time_limit_minutes+' minute time limit';
  $('#candidate-status').textContent=me.status;
  if(me.status==='Completed'){
    stopTimer();$('#candidate-workspace').hidden=true;$('#candidate-start-panel').hidden=true;
    $('#candidate-timer-panel').hidden=true;$('#candidate-finished').hidden=false;
    $('#candidate-final-score').textContent=me.score+' / 100';return;
  }
  $('#candidate-finished').hidden=true;
  if(me.status==='Invited'){
    $('#candidate-workspace').hidden=true;$('#candidate-start-panel').hidden=false;
    $('#candidate-start').disabled=!me.can_start;
    $('#candidate-start-message').textContent=me.can_start
      ? 'The assessment is open. Starting it will begin your personal timer.'
      : 'Your invitation is valid. The Start button becomes available during the scheduled assessment window.';
  }else if(me.status==='Started'){
    $('#candidate-start-panel').hidden=true;$('#candidate-workspace').hidden=false;
    startTimer(me.remaining_seconds);
    await loadProblems();
  }
}

async function finishAssessment() {
  if(!assessmentData||assessmentData.status!=='Started')return;
  if(!confirm('Finish and submit this assessment now? You will not be able to change your answers afterwards.'))return;
  $('#candidate-finish').disabled=true;
  try{
    const result=await api('/api/candidate-assessment/finish',{method:'POST'});
    setNotice('Assessment submitted. Your score: '+result.score+' / 100.');
    await refreshCandidateState();
  }catch(error){setNotice(error.message,true);$('#candidate-finish').disabled=false;}
}
async function refreshCandidateState() {
  try{const me=await api('/api/candidate-assessment/me');await renderAssessmentState(me);}
  catch(error){setNotice(error.message,true);}
}

async function beginAssessment() {
  $('#candidate-start').disabled=true;
  try{
    await api('/api/candidate-assessment/start',{method:'POST'});
    setNotice('Assessment started. Your time limit is now running.');
    await refreshCandidateState();
  }catch(error){setNotice(error.message,true);$('#candidate-start').disabled=false;}
}

$('#candidate-start').addEventListener('click',beginAssessment);
$('#candidate-finish').addEventListener('click',finishAssessment);
$('#candidate-run').addEventListener('click',()=>submitCode('run'));
$('#candidate-submit').addEventListener('click',()=>submitCode('submit'));

(async()=>{
  const hash=window.location.hash.startsWith('#')?window.location.hash.slice(1):window.location.hash;
  invitationToken=new URLSearchParams(hash).get('token')||'';
  if(!/^[a-f0-9]{64}$/i.test(invitationToken)){setNotice('This invitation link is missing or invalid. Ask the organizer for a new invitation.',true);return;}
  try{const me=await api('/api/candidate-assessment/me');await renderAssessmentState(me);}
  catch(error){setNotice(error.message,true);$('#candidate-status').textContent='Unavailable';}
})();