const $ = (selector) => document.querySelector(selector);
const list = $('#problem-list');
const template = $('#problem-template');
let problems = [];
let topics = [];
let currentUser = null;
let currentProblemId = null;
let availableLanguages = null;
let contests = [];
let activeContest = null;
let currentContestId = null;
let currentContestStatus = null;

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
  $('#progress-panel').hidden = !(signedIn && currentUser.role_category === 'Learner');
  $('#create-contest-button').hidden = !(signedIn && ['Organizer', 'Admin'].includes(currentUser.role_category));
  $('#assessment-section').hidden = !(signedIn && ['Organizer', 'Admin'].includes(currentUser.role_category));
  $('#create-assessment-button').hidden = !(signedIn && ['Organizer', 'Admin'].includes(currentUser.role_category));
  $('#show-inactive').disabled = !signedIn;
  $('#role-workspace').hidden = !signedIn;
  $('#reviewer-panel').hidden = !(signedIn && ['Reviewer','Admin'].includes(currentUser.role_category));
  $('#mentor-panel').hidden = !(signedIn && ['Mentor','Learner','Admin'].includes(currentUser.role_category));
  $('#mentor-feedback-form').hidden = !(signedIn && ['Mentor','Admin'].includes(currentUser.role_category));
  $('#support-panel').hidden = !signedIn;
  $('#support-agent-queue').hidden = !(signedIn && ['Support','Admin'].includes(currentUser.role_category));
  $('#judge-panel').hidden = !(signedIn && ['Judge','Admin'].includes(currentUser.role_category));
  $('#admin-panel').hidden = !(signedIn && currentUser.role_category === 'Admin');
  const canViewProgress = signedIn && currentUser.role_category === 'Learner';
  $('#progress-button').hidden = !canViewProgress;
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

function workspaceMessage(message, isError = false) {
  const node = $('#workspace-message');
  node.textContent = message;
  node.dataset.state = isError ? 'error' : 'success';
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

async function loadReviewQueue() {
  const container = $('#review-queue');
  container.replaceChildren();
  try {
    const payload = await api('/api/problems/review-queue');
    if (!payload.problems.length) { container.append(element('p','muted','No problems are waiting for review.')); return; }
    for (const problem of payload.problems) {
      const card = element('article','workspace-item');
      const title = element('h4','', '#' + problem.problem_id + ' · ' + problem.title);
      const meta = element('p','muted',problem.difficulty + ' · ' + problem.review_status + ' · ' + (problem.creator_name || 'Unknown creator'));
      const statement = element('p','workspace-item-text',problem.problem_statement || 'No statement supplied.');
      const comments = document.createElement('textarea');
      comments.rows = 3; comments.maxLength = 5000; comments.placeholder = 'Review comments for the Organizer…';
      comments.setAttribute('aria-label','Review comments for problem ' + problem.problem_id);
      const actions = element('div','workspace-actions');
      for (const decision of ['APPROVED','CHANGES_REQUESTED','REJECTED']) {
        const button = element('button',decision==='APPROVED'?'':'secondary',decision.replaceAll('_',' '));
        button.type='button';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try {
            await api('/api/problems/'+problem.problem_id+'/reviews',{method:'POST',body:JSON.stringify({decision,comments:comments.value})});
            workspaceMessage('Problem #'+problem.problem_id+' review saved: '+decision+'.');
            await loadReviewQueue(); await loadProblems();
          } catch(error){workspaceMessage(error.message,true);button.disabled=false;}
        });
        actions.append(button);
      }
      card.append(title,meta,statement,comments,actions);
      container.append(card);
    }
  } catch(error){container.append(element('p','error',error.message));}
}

async function loadAdminUsers() {
  const container=$('#admin-user-list');
  container.replaceChildren(element('p','muted','Loading accounts…'));
  const query=new URLSearchParams();
  if($('#admin-user-query').value.trim()) query.set('q',$('#admin-user-query').value.trim());
  if($('#admin-include-inactive').checked) query.set('includeInactive','true');
  try {
    const payload=await api('/api/admin/users?'+query.toString());
    container.replaceChildren();
    for(const user of payload.users){
      const card=element('article','workspace-item admin-user-row');
      const title=element('h4','',user.name+' · #'+user.user_id);
      const meta=element('p','muted',user.email+' · Joined '+new Date(user.joined_at).toLocaleDateString()+(user.org_name?' · '+user.org_name:''));
      const controls=element('div','admin-user-controls');
      const roleSelect=document.createElement('select');
      roleSelect.setAttribute('aria-label','Role for '+user.email);
      for(const role of payload.roles){const option=element('option','',role.role_name);option.value=role.role_id;option.selected=Number(role.role_id)===Number(user.role_id);roleSelect.append(option);}
      const organization=document.createElement('input');
      organization.type='number';organization.min='1';organization.placeholder='Organization ID (only when creating Organizer profile)';
      organization.value=user.organization_id||'';organization.setAttribute('aria-label','Organizer organization ID for '+user.email);
      const activeLabel=element('label','inline-check','Active');
      const active=document.createElement('input');active.type='checkbox';active.checked=Boolean(user.is_active);activeLabel.prepend(active);
      const save=element('button','','Save account');save.type='button';
      save.addEventListener('click',async()=>{
        save.disabled=true;
        const body={role_id:Number(roleSelect.value),is_active:active.checked};
        if(organization.value)body.organization_id=Number(organization.value);
        try {
          await api('/api/admin/users/'+user.user_id,{method:'PATCH',body:JSON.stringify(body)});
          workspaceMessage('Updated '+user.email+'.');
          await loadAdminUsers();
        } catch(error){workspaceMessage(error.message,true);save.disabled=false;}
      });
      controls.append(roleSelect,organization,activeLabel,save);
      card.append(title,meta,controls);container.append(card);
    }
    if(!payload.users.length)container.append(element('p','muted','No accounts matched your search.'));
  } catch(error){container.replaceChildren(element('p','error',error.message));}
}

async function loadAdminAudit() {
  const container=$('#admin-audit-list');container.replaceChildren();
  try {
    const payload=await api('/api/admin/audit');
    for(const event of payload.events){
      const row=element('article','workspace-item');
      row.append(element('strong','',event.action+' · '+event.entity_type+' '+(event.entity_id||'')));
      row.append(element('p','muted',(event.actor_name||'Former user')+' · '+new Date(event.created_at).toLocaleString()));
      row.append(element('pre','workspace-json',JSON.stringify(event.details,null,2)));
      container.append(row);
    }
    if(!payload.events.length)container.append(element('p','muted','No audit events recorded yet.'));
  } catch(error){container.append(element('p','error',error.message));}
}

async function loadMentorFeedback() {
  const container=$('#mentor-feedback-list');container.replaceChildren();
  try {
    const payload=await api('/api/mentor/feedback');
    for(const item of payload.feedback){
      const card=element('article','workspace-item');
      const person=currentUser.role_category==='Learner'?'From '+item.mentor_name:'To '+item.learner_name;
      card.append(element('h4','',person+(item.problem_title?' · '+item.problem_title:'')));
      card.append(element('p','muted',new Date(item.created_at).toLocaleString()+(item.submission_id?' · Submission #'+item.submission_id:'')));
      card.append(element('p','workspace-item-text',item.feedback));
      container.append(card);
    }
    if(!payload.feedback.length)container.append(element('p','muted','No feedback available yet.'));
  } catch(error){container.append(element('p','error',error.message));}
}

function renderTicket(container,ticket,staff=false) {
  const card=element('article','workspace-item');
  card.append(element('h4','','#'+ticket.ticket_id+' · '+ticket.subject));
  card.append(element('p','muted',ticket.priority+' · '+ticket.status+' · '+new Date(ticket.created_at).toLocaleString()+(ticket.requester_name?' · '+ticket.requester_name:'')));
  card.append(element('p','workspace-item-text',ticket.description));
  if(staff){
    const controls=element('div','workspace-actions');
    const status=document.createElement('select');
    for(const value of ['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED']){const option=element('option','',value);option.value=value;option.selected=value===ticket.status;status.append(option);}
    const priority=document.createElement('select');
    for(const value of ['LOW','MEDIUM','HIGH','URGENT']){const option=element('option','',value);option.value=value;option.selected=value===ticket.priority;priority.append(option);}
    const agent=document.createElement('input');agent.type='number';agent.min='1';agent.placeholder='Support user ID (optional)';agent.value=ticket.assigned_support_id||'';
    const save=element('button','','Update ticket');save.type='button';
    save.addEventListener('click',async()=>{
      save.disabled=true;
      const body={status:status.value,priority:priority.value};
      if(agent.value)body.assigned_support_id=Number(agent.value);
      try{await api('/api/support/tickets/'+ticket.ticket_id,{method:'PATCH',body:JSON.stringify(body)});await loadSupportTickets();}
      catch(error){workspaceMessage(error.message,true);save.disabled=false;}
    });
    controls.append(status,priority,agent,save);card.append(controls);
  }
  container.append(card);
}

async function loadSupportTickets() {
  const mine=$('#my-support-tickets');mine.replaceChildren();
  try {
    const own=await api('/api/support/tickets/mine');
    for(const ticket of own.tickets)renderTicket(mine,ticket,false);
    if(!own.tickets.length)mine.append(element('p','muted','You have not raised a support ticket.'));
  } catch(error){mine.append(element('p','error',error.message));}
  if(['Support','Admin'].includes(currentUser?.role_category)){
    const queue=$('#support-queue-list');queue.replaceChildren();
    try{const payload=await api('/api/support/tickets');for(const ticket of payload.tickets)renderTicket(queue,ticket,true);
      if(!payload.tickets.length)queue.append(element('p','muted','No support tickets are waiting.'));}
    catch(error){queue.append(element('p','error',error.message));}
  }
}

async function loadJudgeContestReview() {
  const id=Number($('#judge-contest-id').value);
  const container=$('#judge-review-results');container.replaceChildren();
  if(!Number.isSafeInteger(id)||id<=0){$('#judge-review-message').textContent='Enter a valid contest ID.';return;}
  try{
    const payload=await api('/api/judge/contests/'+id+'/reviews');
    $('#judge-review-message').textContent=payload.contest.name+' · '+new Date(payload.contest.end_time).toLocaleString();
    const heading=element('h4','','Leaderboard');container.append(heading);
    for(const entry of payload.leaderboard){
      container.append(element('p','workspace-item-text','#'+entry.rank+' · '+entry.learner_name+' · '+entry.score+' points · '+entry.penalty+' penalty minutes'));
    }
    container.append(element('h4','','Previous judge reviews'));
    for(const review of payload.reviews){
      container.append(element('p','muted',review.decision+' · '+review.judge_name+' · '+new Date(review.reviewed_at).toLocaleString()));
      if(review.notes)container.append(element('p','workspace-item-text',review.notes));
    }
    if(!payload.reviews.length)container.append(element('p','muted','No Judge review has been recorded.'));
  }catch(error){$('#judge-review-message').textContent=error.message;}
}

async function loadRoleWorkspace() {
  if(!currentUser)return;
  const category=currentUser.role_category;
  if(['Reviewer','Admin'].includes(category))await loadReviewQueue();
  if(['Mentor','Learner','Admin'].includes(category))await loadMentorFeedback();
  await loadSupportTickets();
  if(category==='Admin'){await loadAdminUsers();await loadAdminAudit();}
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
    row.querySelector('.retired-tag').textContent = problem.review_status === 'PENDING_REVIEW'
      ? 'Pending review'
      : problem.review_status === 'CHANGES_REQUESTED' ? 'Changes requested'
      : problem.review_status === 'REJECTED' ? 'Rejected'
      : problem.review_status === 'RETIRED' ? 'Retired' : 'Inactive';
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

let assessments = [];
let assessmentOrganizations = [];
let activeAssessment = null;

async function loadAssessmentOrganizations() {
  const result = await api('/api/organizations');
  assessmentOrganizations = result.organizations || [];
  const select = $('#assessment-organization');
  select.replaceChildren();
  for (const organization of assessmentOrganizations) {
    const option = document.createElement('option');
    option.value = organization.organization_id;
    option.textContent = organization.org_name;
    select.append(option);
  }
  const isAdmin = currentUser?.role_category === 'Admin';
  $('#assessment-organization-field').hidden = !isAdmin;
  select.disabled = !isAdmin;
  return assessmentOrganizations;
}

function renderAssessments() {
  const container = $('#assessment-list');
  container.replaceChildren();
  if (!assessments.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = 'No company assessments are configured for this organization.';
    container.append(empty); return;
  }
  for (const assessment of assessments) {
    const card = document.createElement('article'); card.className = 'assessment-card';
    const info = document.createElement('div'); info.className = 'assessment-card-main';
    const heading = document.createElement('div'); heading.className = 'assessment-card-heading';
    const title = document.createElement('h3'); title.textContent = assessment.title;
    const status = document.createElement('span'); status.className = 'assessment-status ' + assessment.assessment_status.toLowerCase(); status.textContent = assessment.assessment_status;
    heading.append(title,status);
    const description = document.createElement('p'); description.textContent = assessment.description || 'No description provided.';
    const meta = document.createElement('p'); meta.className = 'muted';
    meta.textContent = formatAssessmentDate(assessment.start_time) + ' — ' + formatAssessmentDate(assessment.end_time) +
      ' · ' + assessment.time_limit_minutes + ' min · ' + assessment.problem_count + ' problems · ' +
      assessment.candidate_count + ' candidates · ' + (assessment.organization_name || 'Unassigned legacy assessment');
    info.append(heading,description,meta);
    const actions = document.createElement('div'); actions.className = 'assessment-card-actions';
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'Manage';
    view.addEventListener('click',()=>openAssessmentDetails(assessment.assessment_id));
    actions.append(view);
    if(assessment.assessment_status==='UPCOMING'){
      const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='Edit';
      edit.addEventListener('click',()=>openAssessmentForm(assessment.assessment_id));actions.append(edit);
    }
    card.append(info,actions);container.append(card);
  }
}

function formatAssessmentDate(value) {
  return new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
}

async function loadAssessments() {
  if(!currentUser||!['Organizer','Admin'].includes(currentUser.role_category))return;
  const container=$('#assessment-list');
  try{const result=await api('/api/assessments');assessments=result.assessments||[];renderAssessments();}
  catch(error){container.textContent=error.message;}
}

function populateAssessmentProblemOptions(selected=[]) {
  const select=$('#assessment-problem-ids');select.replaceChildren();
  for(const problem of problems.filter(p=>p.is_active)){
    const option=document.createElement('option');option.value=problem.problem_id;
    option.textContent='#'+problem.problem_id+' · '+problem.title+' ('+problem.difficulty+')';
    option.selected=selected.includes(Number(problem.problem_id));select.append(option);
  }
}

async function openAssessmentForm(assessmentId=null) {
  $('#assessment-form').reset();$('#assessment-form-error').textContent='';$('#assessment-id').value=assessmentId||'';
  $('#assessment-form-title').textContent=assessmentId?'Edit upcoming assessment':'Create assessment';
  try{
    await loadAssessmentOrganizations();
    populateAssessmentProblemOptions();
    if(assessmentId){
      const detail=await api('/api/assessments/'+assessmentId);
      const a=detail.assessment;
      $('#assessment-title-input').value=a.title;
      $('#assessment-description-input').value=a.description||'';
      $('#assessment-start').value=toDateTimeLocal(a.start_time);
      $('#assessment-end').value=toDateTimeLocal(a.end_time);
      $('#assessment-time-limit').value=a.time_limit_minutes;
      if(a.organization_id)$('#assessment-organization').value=a.organization_id;
      populateAssessmentProblemOptions(detail.problems.map(p=>Number(p.problem_id)));
    }
    $('#assessment-editor').hidden=false;
    $('#assessment-editor').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){$('#assessment-form-error').textContent=error.message;}
}

function renderAssessmentProblems(rows) {
  const container=$('#assessment-detail-problems');container.replaceChildren();
  if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No problems assigned.';container.append(empty);return;}
  for(const problem of rows){
    const row=document.createElement('div');row.className='assessment-problem-row';
    const title=document.createElement('strong');title.textContent=problem.order_no+'. '+problem.title;
    const difficulty=document.createElement('span');difficulty.className='difficulty';difficulty.dataset.level=problem.difficulty.toLowerCase();difficulty.textContent=problem.difficulty;
    row.append(title,difficulty);container.append(row);
  }
}

function renderAssessmentCandidates(rows) {
  const container=$('#assessment-candidates');container.replaceChildren();
  if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No candidates have been invited yet.';container.append(empty);return;}
  const table=document.createElement('table');table.className='assessment-candidate-table';
  const head=document.createElement('thead');const hr=document.createElement('tr');
  for(const label of ['Candidate','Email','Status','Score']){const th=document.createElement('th');th.textContent=label;hr.append(th);}head.append(hr);
  const body=document.createElement('tbody');
  for(const candidate of rows){
    const row=document.createElement('tr');
    for(const value of [candidate.name,candidate.email,candidate.status,candidate.score==null?'—':candidate.score+' / 100']){const td=document.createElement('td');td.textContent=value;row.append(td);}
    body.append(row);
  }
  table.append(head,body);container.append(table);
}

async function openAssessmentDetails(assessmentId) {
  try{
    const result=await api('/api/assessments/'+assessmentId);
    activeAssessment=result.assessment;
    const a=activeAssessment;
    $('#assessment-detail-title').textContent=a.title;
    $('#assessment-detail-status').textContent=a.assessment_status;
    $('#assessment-detail-meta').textContent=formatAssessmentDate(a.start_time)+' — '+formatAssessmentDate(a.end_time)+' · '+a.time_limit_minutes+' minute limit · '+(a.organization_name||'Organization');
    renderAssessmentProblems(result.problems||[]);
    renderAssessmentCandidates(result.candidates||[]);
    await loadAssessmentSuspiciousActivity(assessmentId);
    const canInvite=a.assessment_status==='UPCOMING';
    $('#assessment-invite-form').hidden=!canInvite;
    $('#assessment-invitation-link').hidden=true;
    $('#assessment-report-section').hidden=a.assessment_status!=='ENDED';
    if(a.assessment_status==='ENDED')await loadAssessmentReport(assessmentId);
    const dialog=$('#assessment-dialog');if(!dialog.open)dialog.showModal();
  }catch(error){notify(error.message,'error');}
}

async function loadAssessmentSuspiciousActivity(assessmentId) {
  const container=$('#assessment-suspicious-activity');container.replaceChildren();
  try {
    const result=await api('/api/assessments/'+assessmentId+'/suspicious-activity');
    if(!result.activities.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No activity indicators have been recorded for this assessment.';container.append(empty);return;}
    for(const item of result.activities){
      const card=document.createElement('article');card.className='workspace-item';
      const title=document.createElement('h4');title.textContent=item.event_type.replaceAll('_',' ')+' · '+item.candidate_name;
      const meta=document.createElement('p');meta.className='muted';meta.textContent=item.candidate_email+' · '+new Date(item.detected_at).toLocaleString();
      const context=document.createElement('p');context.className='workspace-item-text';context.textContent=JSON.stringify(item.metadata||{});
      const note=document.createElement('textarea');note.rows=2;note.maxLength=5000;note.placeholder='Human review notes…';note.value=item.review_notes||'';
      const status=document.createElement('select');
      for(const value of ['PENDING','REVIEWED','DISMISSED']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===item.review_status;status.append(option);}
      const save=document.createElement('button');save.type='button';save.textContent='Save review';
      save.addEventListener('click',async()=>{
        save.disabled=true;
        try{
          await api('/api/assessments/'+assessmentId+'/suspicious-activity/'+item.activity_id,{method:'PATCH',body:JSON.stringify({review_status:status.value,review_notes:note.value})});
          $('#assessment-detail-meta').textContent=$('#assessment-detail-meta').textContent;
          await loadAssessmentSuspiciousActivity(assessmentId);
        }catch(error){notify(error.message,'error');save.disabled=false;}
      });
      const actions=document.createElement('div');actions.className='workspace-actions';actions.append(status,save);
      card.append(title,meta,context,note,actions);container.append(card);
    }
    if(result.notice)container.prepend(Object.assign(document.createElement('p'),{className:'muted',textContent:result.notice}));
  }catch(error){container.append(Object.assign(document.createElement('p'),{className:'error',textContent:error.message}));}
}

async function loadAssessmentReport(assessmentId) {
  const container=$('#assessment-report');container.replaceChildren();
  try{
    const result=await api('/api/assessments/'+assessmentId+'/report');
    if(!result.candidates.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No candidate report records are available.';container.append(empty);return;}
    const table=document.createElement('table');table.className='assessment-report-table';
    const head=document.createElement('thead');const hr=document.createElement('tr');
    for(const label of ['Candidate','Status','Score','Submissions','Accepted','Solved','Time','Languages']){const th=document.createElement('th');th.textContent=label;hr.append(th);}head.append(hr);
    const body=document.createElement('tbody');
    for(const candidate of result.candidates){
      const row=document.createElement('tr');
      const values=[candidate.name+' · '+candidate.email,candidate.status,candidate.score==null?'—':candidate.score+'%',candidate.submission_count,candidate.accepted_submissions,candidate.solved_problems,formatDuration(candidate.total_execution_time_ms),candidate.languages_used||'—'];
      for(const value of values){const td=document.createElement('td');td.textContent=value;row.append(td);}body.append(row);
    }
    table.append(head,body);container.append(table);
  }catch(error){container.textContent=error.message;}
}

async function createCandidateInvitation(event) {
  event.preventDefault();if(!activeAssessment)return;
  $('#invite-candidate-submit').disabled=true;$('#invite-candidate-error').textContent='';
  try{
    const result=await api('/api/assessments/'+activeAssessment.assessment_id+'/invitations',{
      method:'POST',body:JSON.stringify({name:$('#invite-candidate-name').value,email:$('#invite-candidate-email').value})
    });
    $('#assessment-invite-form').reset();
    $('#assessment-generated-link').value=result.invitation_url;
    $('#assessment-invitation-link').hidden=false;
    await openAssessmentDetails(activeAssessment.assessment_id);
    $('#assessment-generated-link').value=result.invitation_url;
    $('#assessment-invitation-link').hidden=false;
    setTimeout(()=>$('#assessment-generated-link').focus(),0);
  }catch(error){$('#invite-candidate-error').textContent=error.message;}
  finally{$('#invite-candidate-submit').disabled=false;}
}

async function copyAssessmentInviteLink() {
  const value=$('#assessment-generated-link').value;
  if(!value)return;
  try{await navigator.clipboard.writeText(value);notify('Invitation link copied. Share it privately with the candidate.','success');}
  catch{$('#assessment-generated-link').focus();$('#assessment-generated-link').select();notify('Select the link and copy it manually.','');}
}

function contestDate(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function renderContests() {
  const container = $('#contest-list');
  container.replaceChildren();
  if (!contests.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No contests are scheduled yet.'; container.append(empty); return;
  }
  for (const contest of contests) {
    const card = document.createElement('article'); card.className = 'contest-card';
    const main = document.createElement('div'); main.className = 'contest-card-main';
    const heading = document.createElement('div'); heading.className = 'contest-card-heading';
    const title = document.createElement('h3'); title.textContent = contest.name;
    const status = document.createElement('span'); status.className = 'contest-status ' + contest.contest_status.toLowerCase(); status.textContent = contest.contest_status;
    heading.append(title, status);
    const dates = document.createElement('p'); dates.textContent = contestDate(contest.start_time) + ' — ' + contestDate(contest.end_time);
    const meta = document.createElement('p'); meta.className = 'muted'; meta.textContent = contest.problem_count + ' problems · ' + contest.participant_count + ' participants · Organized by ' + contest.organizer_name;
    main.append(heading, dates, meta);
    const actions = document.createElement('div'); actions.className = 'contest-card-actions';
    if (contest.is_registered) { const reg = document.createElement('span'); reg.className = 'registered-label'; reg.textContent = 'Registered'; actions.append(reg); }
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'View contest';
    view.addEventListener('click', () => openContestDetails(contest.contest_id)); actions.append(view);
    const canEdit = currentUser && (currentUser.role_category === 'Admin' || (currentUser.role_category === 'Organizer' && Number(contest.organizer_id) === Number(currentUser.user_id))) && contest.contest_status === 'UPCOMING';
    if (canEdit) { const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = 'Edit'; edit.addEventListener('click', () => openContestForm(contest.contest_id)); actions.append(edit); }
    card.append(main, actions); container.append(card);
  }
}

async function loadContests() {
  const container = $('#contest-list');
  try { const payload = await api('/api/contests'); contests = payload.contests || []; renderContests(); }
  catch (error) { container.textContent = error.message; }
}

function populateContestProblemOptions(selected = []) {
  const select = $('#contest-problem-ids'); select.replaceChildren();
  for (const problem of problems.filter((item) => item.is_active)) {
    const option = document.createElement('option'); option.value = problem.problem_id;
    option.textContent = '#' + problem.problem_id + ' · ' + problem.title + ' (' + problem.difficulty + ')';
    option.selected = selected.includes(Number(problem.problem_id)); select.append(option);
  }
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function openContestForm(contestId = null) {
  $('#contest-form').reset(); $('#contest-form-error').textContent = ''; $('#contest-id').value = contestId || '';
  $('#contest-form-title').textContent = contestId ? 'Edit upcoming contest' : 'Create a contest';
  populateContestProblemOptions();
  if (contestId) {
    try {
      const payload = await api('/api/contests/' + contestId); const c = payload.contest;
      $('#contest-name').value = c.name; $('#contest-start').value = toDateTimeLocal(c.start_time);
      $('#contest-end').value = toDateTimeLocal(c.end_time); $('#contest-rules').value = c.rules || '';
      $('#contest-points').value = c.points_per_problem ?? 100;
      $('#contest-wrong-penalty').value = c.wrong_attempt_penalty_minutes ?? 5;
      $('#contest-time-penalty').checked = Boolean(c.time_penalty_enabled);
      populateContestProblemOptions(payload.problems.map((p) => Number(p.problem_id)));
    } catch (error) { $('#contest-form-error').textContent = error.message; return; }
  }
  $('#contest-editor').hidden = false; $('#contest-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderContestProblems(rows, contest) {
  const container = $('#contest-detail-problems'); container.replaceChildren();
  const canSolve = contest.contest_status === 'LIVE' && contest.is_registered;
  const canManageProblemSet = Boolean(contest.can_manage) && contest.contest_status === 'UPCOMING';
  $('#contest-moderation-controls').hidden = !canManageProblemSet;
  if ((contest.contest_status === 'UPCOMING' && !contest.can_manage) ||
      (contest.contest_status === 'LIVE' && !contest.can_manage && !contest.is_registered)) {
    const message = document.createElement('p'); message.className = 'muted';
    message.textContent = contest.contest_status === 'UPCOMING'
      ? 'Contest problems become accessible when the contest starts.'
      : 'Only registered participants can view live contest problems.'; container.append(message); return;
  }
  for (const problem of rows) {
    const row = document.createElement('div'); row.className = 'contest-problem-row';
    const info = document.createElement('div'); const title = document.createElement('strong');
    title.textContent = '#' + problem.problem_id + ' · ' + problem.title;
    const difficulty = document.createElement('span'); difficulty.className = 'difficulty';
    difficulty.dataset.level = problem.difficulty.toLowerCase(); difficulty.textContent = problem.difficulty;
    info.append(title, difficulty);
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = canSolve ? 'Solve in contest' : 'Open problem'; button.className = canSolve ? '' : 'secondary';
    button.addEventListener('click', async () => {
      $('#contest-dialog').close();
      await openProblemDetails(problem.problem_id, canSolve ? contest.contest_id : null, canSolve ? 'LIVE' : null);
    });
    row.append(info, button);
    if (canManageProblemSet) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'danger secondary'; remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await api('/api/contests/' + contest.contest_id + '/problems/' + problem.problem_id, { method: 'DELETE' });
          $('#contest-moderation-message').textContent = 'Problem removed from the contest.';
          await openContestDetails(contest.contest_id);
        } catch (error) {
          $('#contest-moderation-message').textContent = error.message;
          remove.disabled = false;
        }
      });
      row.append(remove);
    }
    container.append(row);
  }
}

function renderContestLeaderboard(rows) {
  const container = $('#contest-leaderboard'); container.replaceChildren();
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No participants are registered yet.'; container.append(empty); return; }
  const table = document.createElement('table'); table.className = 'leaderboard-table';
  const head = document.createElement('thead'); const headerRow = document.createElement('tr');
  for (const label of ['Rank', 'Learner', 'Score', 'Penalty']) { const th = document.createElement('th'); th.textContent = label; headerRow.append(th); }
  head.append(headerRow); const body = document.createElement('tbody');
  for (const entry of rows) { const row = document.createElement('tr'); for (const value of [entry.rank, entry.learner_name, entry.score, entry.penalty]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } body.append(row); }
  table.append(head, body); container.append(table);
}

async function openContestDetails(contestId) {
  try {
    const results = await Promise.all([api('/api/contests/' + contestId), api('/api/contests/' + contestId + '/leaderboard')]);
    const detail = results[0]; const board = results[1]; activeContest = detail.contest;
    const c = activeContest;
    c.is_organizer = currentUser && (currentUser.role_category === 'Admin' || (currentUser.role_category === 'Organizer' && Number(c.organizer_id) === Number(currentUser.user_id)));
    c.is_moderator = currentUser?.role_category === 'Moderator';
    $('#contest-moderation-message').textContent = '';
    const chosen = new Set((detail.problems || []).map((p) => Number(p.problem_id)));
    const addProblemSelect = $('#contest-add-problem-select');
    addProblemSelect.replaceChildren();
    for (const problem of problems.filter((p) => p.is_active && !chosen.has(Number(p.problem_id)))) {
      const option = document.createElement('option');
      option.value = problem.problem_id;
      option.textContent = '#' + problem.problem_id + ' · ' + problem.title + ' (' + problem.difficulty + ')';
      addProblemSelect.append(option);
    }
    if (!addProblemSelect.options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No more active problems available';
      addProblemSelect.append(option);
    }
    $('#contest-add-problem-button').disabled = !addProblemSelect.options.length || !addProblemSelect.value;
    $('#contest-detail-title').textContent = c.name; $('#contest-detail-status').textContent = c.contest_status;
    $('#contest-detail-meta').textContent = contestDate(c.start_time) + ' — ' + contestDate(c.end_time) + ' · ' + c.participant_count + ' participants';
    $('#contest-detail-rules').textContent = c.rules || 'No additional rules were provided.';
    $('#contest-scoring-summary').textContent =
      'Scoring: ' + c.points_per_problem + ' points per solved problem; ' +
      c.wrong_attempt_penalty_minutes + ' penalty minutes per wrong full submission before acceptance' +
      (c.time_penalty_enabled ? ', plus elapsed minutes to accepted solutions.' : '.') +
      ' Higher score ranks first, then lower penalty.';
    const register = $('#contest-register-button');
    register.hidden = !(currentUser?.role_category === 'Learner' && c.contest_status === 'UPCOMING' && !c.is_registered);
    $('#contest-action-message').textContent = c.is_registered ? 'You are registered for this contest.' :
      c.contest_status === 'UPCOMING' && currentUser?.role_category !== 'Learner' ? 'Sign in with a Learner account to register.' :
      c.contest_status === 'LIVE' ? 'Registration is closed. Only registered learners can submit.' : '';
    $('#contest-edit-button').hidden = !(c.is_organizer && c.contest_status === 'UPCOMING');
    renderContestProblems(detail.problems || [], c); renderContestLeaderboard(board.leaderboard || []);
    $('#contest-add-problem-select').disabled = !c.can_manage || c.contest_status !== 'UPCOMING' || $('#contest-add-problem-select').options.length === 0;
    $('#contest-add-problem-button').disabled = $('#contest-add-problem-select').disabled;
    const dialog = $('#contest-dialog'); if (!dialog.open) dialog.showModal();
  } catch (error) { notify(error.message, 'error'); }
}

async function registerForActiveContest() {
  if (!activeContest) return;
  const button = $('#contest-register-button'); button.disabled = true;
  try {
    await api('/api/contests/' + activeContest.contest_id + '/register', { method: 'POST' });
    $('#contest-action-message').textContent = 'Registration successful.';
    await loadContests(); await openContestDetails(activeContest.contest_id);
  } catch (error) { $('#contest-action-message').textContent = error.message; }
  finally { button.disabled = false; }
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
    populateContestProblemOptions();
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

async function openProblemDetails(problemId, contestId = null, contestStatus = null) {
  currentContestId = contestId;
  currentContestStatus = contestStatus;
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
      await loadProgress();
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
      body: JSON.stringify({ problem_id: currentProblemId, language_id: languageId, code, action, contest_id: currentContestId })
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
  if (currentContestId && currentContestStatus !== 'LIVE') {
    $('#run-samples').disabled = true;
    $('#submit-code').disabled = true;
    $('#submission-language').disabled = true;
    $('#language-help').textContent = 'Contest submissions are available only during the live contest window.';
    return;
  }
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

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  if (totalSeconds < 60) return totalSeconds + ' sec';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + ' min ' + seconds + ' sec';
  return Math.floor(minutes / 60) + ' hr ' + (minutes % 60) + ' min';
}

function renderDailyActivity(days) {
  const container = $('#daily-activity');
  container.replaceChildren();
  const max = Math.max(1, ...days.map((day) => Number(day.submissions) || 0));
  for (const day of days) {
    const item = document.createElement('div');
    item.className = 'activity-day';
    const bar = document.createElement('div');
    bar.className = 'activity-bar';
    const count = Number(day.submissions) || 0;
    bar.style.height = Math.max(3, Math.round(count / max * 74)) + 'px';
    if (count === 0) bar.classList.add('is-empty');
    const date = new Date(day.activity_day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    item.title = date + ': ' + count + ' submissions, ' + (Number(day.accepted) || 0) + ' accepted';
    item.setAttribute('aria-label', item.title);
    const label = document.createElement('span');
    label.textContent = Number(day.activity_day.slice(-2)) % 5 === 0 ? date : '';
    item.append(bar, label);
    container.append(item);
  }
}

function renderTopicPerformance(topics) {
  const container = $('#topic-performance');
  container.replaceChildren();
  if (!topics.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Topic performance will appear after you submit solutions to tagged problems.';
    container.append(empty);
    return;
  }
  for (const topic of topics) {
    const row = document.createElement('div');
    row.className = 'topic-progress-row';
    const heading = document.createElement('div');
    heading.className = 'topic-progress-heading';
    const name = document.createElement('strong');
    name.textContent = topic.name;
    const ratio = document.createElement('span');
    ratio.textContent = topic.solved_problems + ' / ' + topic.attempted_problems + ' solved';
    heading.append(name, ratio);
    const track = document.createElement('div');
    track.className = 'metric-track';
    const fill = document.createElement('div');
    fill.className = 'metric-fill';
    const percent = topic.attempted_problems ? topic.solved_problems / topic.attempted_problems * 100 : 0;
    fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    track.append(fill);
    row.append(heading, track);
    container.append(row);
  }
}

function renderLanguageUsage(languages) {
  const container = $('#language-usage');
  container.replaceChildren();
  if (!languages.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Language statistics will appear after your first submission.';
    container.append(empty);
    return;
  }
  for (const language of languages) {
    const row = document.createElement('div');
    row.className = 'language-usage-row';
    const label = document.createElement('span');
    label.textContent = language.name + ' ' + language.version;
    const count = document.createElement('strong');
    count.textContent = language.submissions + ' submissions';
    row.append(label, count);
    container.append(row);
  }
}

function renderRecentActivity(items) {
  const container = $('#recent-activity');
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Your practice submissions will appear here.';
    container.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'recent-progress-row';
    const title = document.createElement('strong');
    title.textContent = item.problem_title;
    const meta = document.createElement('span');
    const label = item.is_run_only ? 'Sample run' : 'Attempt ' + item.attempt_number;
    meta.textContent = label + ' · ' + item.language_name + ' ' + item.language_version +
      ' · ' + (item.verdict_name || item.execution_status) +
      ' · ' + new Date(item.submitted_at).toLocaleString();
    row.append(title, meta);
    container.append(row);
  }
}

async function loadProgress() {
  if (!currentUser || currentUser.role_category !== 'Learner') return;
  const status = $('#progress-status');
  status.textContent = 'Refreshing your progress…';
  try {
    const payload = await api('/api/progress/me');
    const summary = payload.summary;
    $('#progress-solved').textContent = summary.solved_problems;
    $('#progress-attempted').textContent = summary.attempted_problems;
    $('#progress-acceptance').textContent = summary.acceptance_rate + '%';
    $('#progress-streak').textContent = summary.current_streak + ' days';
    $('#progress-total-submissions').textContent = summary.completed_submissions;
    $('#progress-execution-time').textContent = formatDuration(summary.total_execution_time_ms);
    $('#progress-active').textContent = summary.active_submissions;
    renderDailyActivity(payload.daily_activity || []);
    renderTopicPerformance(payload.topic_performance || []);
    renderLanguageUsage(payload.language_usage || []);
    renderRecentActivity(payload.recent_activity || []);
    status.textContent = 'Updated just now. Metrics use practice submissions, not assessment attempts.';
  } catch (error) {
    status.textContent = error.message;
  }
}

$('#registration-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#registration-button').disabled = true;
  $('#registration-error').textContent = '';
  try {
    const result = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#registration-name').value,
        email: $('#registration-email').value,
        password: $('#registration-password').value
      })
    });
    currentUser = result.user;
    $('#registration-password').value = '';
    updateAccountUI();
    await loadProblems();
    await loadProgress();
    await loadContests();
    await loadAssessments();
    notify(result.message || 'Account created successfully.', 'success');
  } catch (error) {
    $('#registration-error').textContent = error.message;
  } finally {
    $('#registration-button').disabled = false;
  }
});

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
    await loadProgress();
    await loadContests();
    await loadAssessments();
    await loadRoleWorkspace();
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
    await loadContests();
    await loadAssessments();
    notify('You have been logged out.', 'success');
    await loadProblems();
  } catch (error) {
    notify(error.message, 'error');
  }
});

$('#new-button').addEventListener('click', () => openForm());
$('#cancel-button').addEventListener('click', () => { $('#form-panel').hidden = true; });
$('#detail-close').addEventListener('click', () => $('#problem-dialog').close());
$('#progress-button').addEventListener('click', async () => {
  const panel = $('#progress-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) await loadProgress();
});
$('#progress-refresh').addEventListener('click', loadProgress);
$('#workspace-refresh').addEventListener('click',loadRoleWorkspace);
$('#review-queue-refresh').addEventListener('click',loadReviewQueue);
$('#mentor-feedback-refresh').addEventListener('click',loadMentorFeedback);
$('#support-refresh').addEventListener('click',loadSupportTickets);
$('#admin-users-refresh').addEventListener('click',loadAdminUsers);
$('#admin-audit-refresh').addEventListener('click',loadAdminAudit);
$('#admin-user-search').addEventListener('submit',async(event)=>{event.preventDefault();await loadAdminUsers();});
$('#judge-review-load').addEventListener('click',loadJudgeContestReview);
$('#judge-review-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const id=Number($('#judge-contest-id').value);
  $('#judge-review-submit').disabled=true;
  try{
    await api('/api/judge/contests/'+id+'/reviews',{method:'POST',body:JSON.stringify({decision:$('#judge-decision').value,notes:$('#judge-review-notes').value})});
    $('#judge-review-notes').value='';
    $('#judge-review-message').textContent='Judge review saved.';
    await loadJudgeContestReview();
  }catch(error){$('#judge-review-message').textContent=error.message;}
  finally{$('#judge-review-submit').disabled=false;}
});
$('#mentor-feedback-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  $('#mentor-feedback-submit').disabled=true;
  try{
    await api('/api/mentor/feedback',{method:'POST',body:JSON.stringify({
      learner_id:Number($('#mentor-learner-id').value),
      problem_id:$('#mentor-problem-id').value?Number($('#mentor-problem-id').value):null,
      submission_id:$('#mentor-submission-id').value?Number($('#mentor-submission-id').value):null,
      feedback:$('#mentor-feedback-text').value
    })});
    $('#mentor-feedback-text').value='';$('#mentor-feedback-message').textContent='Feedback sent.';
    await loadMentorFeedback();
  }catch(error){$('#mentor-feedback-message').textContent=error.message;}
  finally{$('#mentor-feedback-submit').disabled=false;}
});
$('#support-ticket-form').addEventListener('submit',async(event)=>{
  event.preventDefault();$('#support-ticket-submit').disabled=true;
  try{
    await api('/api/support/tickets',{method:'POST',body:JSON.stringify({subject:$('#support-subject').value,description:$('#support-description').value,priority:$('#support-priority').value})});
    $('#support-ticket-form').reset();$('#support-ticket-message').textContent='Support ticket created.';
    await loadSupportTickets();
  }catch(error){$('#support-ticket-message').textContent=error.message;}
  finally{$('#support-ticket-submit').disabled=false;}
});
$('#create-contest-button').addEventListener('click', () => openContestForm());
$('#create-assessment-button').addEventListener('click',()=>openAssessmentForm());
$('#assessment-cancel').addEventListener('click',()=>{$('#assessment-editor').hidden=true;});
$('#assessment-close').addEventListener('click',()=>$('#assessment-dialog').close());
$('#assessment-invite-form').addEventListener('submit',createCandidateInvitation);
$('#copy-invitation-link').addEventListener('click',copyAssessmentInviteLink);
$('#load-assessment-report').addEventListener('click',()=>{if(activeAssessment)loadAssessmentReport(activeAssessment.assessment_id);});
$('#refresh-suspicious-activity').addEventListener('click',()=>{if(activeAssessment)loadAssessmentSuspiciousActivity(activeAssessment.assessment_id);});
$('#assessment-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const id=$('#assessment-id').value;
  const problemIds=Array.from($('#assessment-problem-ids').selectedOptions).map(option=>Number(option.value));
  const body={
    title:$('#assessment-title-input').value,description:$('#assessment-description-input').value,
    start_time:$('#assessment-start').value,end_time:$('#assessment-end').value,
    time_limit_minutes:Number($('#assessment-time-limit').value),problem_ids:problemIds
  };
  if(currentUser?.role_category==='Admin')body.organization_id=Number($('#assessment-organization').value);
  $('#assessment-save').disabled=true;$('#assessment-form-error').textContent='';
  try{
    const result=await api(id?'/api/assessments/'+id:'/api/assessments',{
      method:id?'PUT':'POST',body:JSON.stringify(body)
    });
    $('#assessment-editor').hidden=true;
    notify(id?'Assessment updated.':'Assessment created as #'+result.assessment.assessment_id+'.','success');
    await loadAssessments();await openAssessmentDetails(result.assessment.assessment_id);
  }catch(error){$('#assessment-form-error').textContent=error.message;}
  finally{$('#assessment-save').disabled=false;}
});
$('#contest-cancel').addEventListener('click', () => { $('#contest-editor').hidden = true; });
$('#contest-close').addEventListener('click', () => $('#contest-dialog').close());
$('#contest-register-button').addEventListener('click', registerForActiveContest);
$('#contest-add-problem-button').addEventListener('click', async () => {
  if (!activeContest) return;
  const problemId = Number($('#contest-add-problem-select').value);
  if (!Number.isSafeInteger(problemId) || problemId <= 0) {
    $('#contest-moderation-message').textContent = 'Select a problem first.';
    return;
  }
  const button = $('#contest-add-problem-button');
  button.disabled = true;
  try {
    await api('/api/contests/' + activeContest.contest_id + '/problems', {
      method: 'POST',
      body: JSON.stringify({ problem_id: problemId })
    });
    $('#contest-moderation-message').textContent = 'Problem added to the contest.';
    await openContestDetails(activeContest.contest_id);
  } catch (error) {
    $('#contest-moderation-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#contest-edit-button').addEventListener('click', () => {
  if (!activeContest) return;
  $('#contest-dialog').close();
  openContestForm(activeContest.contest_id);
});
$('#contest-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const contestId = $('#contest-id').value;
  const problemIds = Array.from($('#contest-problem-ids').selectedOptions).map((option) => Number(option.value));
  const body = {
    name: $('#contest-name').value,
    start_time: $('#contest-start').value,
    end_time: $('#contest-end').value,
    rules: $('#contest-rules').value,
    problem_ids: problemIds,
    points_per_problem: Number($('#contest-points').value),
    wrong_attempt_penalty_minutes: Number($('#contest-wrong-penalty').value),
    time_penalty_enabled: $('#contest-time-penalty').checked
  };
  $('#contest-save').disabled = true; $('#contest-form-error').textContent = '';
  try {
    const result = await api(contestId ? '/api/contests/' + contestId : '/api/contests', {
      method: contestId ? 'PUT' : 'POST', body: JSON.stringify(body)
    });
    $('#contest-editor').hidden = true;
    notify(contestId ? 'Contest updated.' : 'Contest created as #' + result.contest.contest_id + '.', 'success');
    await loadContests(); await openContestDetails(result.contest.contest_id);
  } catch (error) { $('#contest-form-error').textContent = error.message; }
  finally { $('#contest-save').disabled = false; }
});
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
    notify(result.message || (id ? 'Changes submitted for Reviewer approval.' : 'Problem submitted for Reviewer approval.'), 'success');
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
  await loadProgress();
  await loadContests();
  await loadAssessments();
  await loadRoleWorkspace();
})();
