const express = require('express');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function rolePrefix(name) {
  const value = String(name || '');
  const marker = value.lastIndexOf(' L');
  return marker < 0 ? value : value.slice(0, marker);
}

module.exports = function createGovernanceRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  async function audit(actorId, action, entityType, entityId, details = {}) {
    try {
      await pool.query(
        `INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [actorId || null,action,entityType,String(entityId ?? ''),JSON.stringify(details || {})]
      );
    } catch (error) {
      console.error('Audit event could not be persisted:', error.message);
    }
  }

  async function organizationScope(user) {
    if (user.role_category === 'Admin') return { admin: true, organizationId: null };
    if (user.role_category !== 'Organizer' || !user.organizer_id) return null;
    const result = await pool.query('SELECT organization_id FROM public.organizer WHERE organizer_id=$1', [user.organizer_id]);
    return result.rowCount ? { admin: false, organizationId: result.rows[0].organization_id } : null;
  }

  router.get('/problems/review-queue', authRequired, allowRoles('Reviewer','Admin'), async (req,res,next) => {
    try {
      const result = await pool.query(
        `SELECT p.problem_id,p.title,p.problem_statement,p.input_format,p.output_format,
                p.constraints,p.difficulty,p.review_status,p.created_at,p.created_by,
                creator.name AS creator_name,
                (SELECT COUNT(*)::integer FROM public.test_case tc WHERE tc.problem_id=p.problem_id) AS test_case_count
         FROM public.problem p
         LEFT JOIN public.organizer o ON o.organizer_id=p.created_by
         LEFT JOIN public.users creator ON creator.user_id=o.organizer_id
         WHERE p.review_status IN ('PENDING_REVIEW','CHANGES_REQUESTED')
         ORDER BY p.created_at,p.problem_id`
      );
      res.json({ problems: result.rows });
    } catch(error) { next(error); }
  });

  router.get('/problems/:id/reviews', authRequired, allowRoles('Reviewer','Organizer','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    if(!id) return res.status(400).json({error:'Invalid problem ID.'});
    try {
      const result=await pool.query(
        `SELECT pr.review_id,pr.problem_id,pr.reviewer_id,u.name AS reviewer_name,
                pr.decision,pr.comments,pr.reviewed_at
         FROM public.problem_review pr JOIN public.users u ON u.user_id=pr.reviewer_id
         WHERE pr.problem_id=$1 ORDER BY pr.reviewed_at DESC`,[id]
      );
      res.json({reviews:result.rows});
    } catch(error){next(error);}
  });

  router.post('/problems/:id/reviews', authRequired, allowRoles('Reviewer','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    const decision=String(req.body.decision || '').toUpperCase();
    const comments=typeof req.body.comments==='string'?req.body.comments.trim():'';
    if(!id) return res.status(400).json({error:'Invalid problem ID.'});
    if(!['APPROVED','CHANGES_REQUESTED','REJECTED'].includes(decision)) return res.status(400).json({error:'Choose APPROVED, CHANGES_REQUESTED, or REJECTED.'});
    if(comments.length>5000) return res.status(400).json({error:'Review comments must be 5000 characters or fewer.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const problem=await client.query('SELECT problem_id,review_status FROM public.problem WHERE problem_id=$1 FOR UPDATE',[id]);
      if(!problem.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Problem not found.'});}
      if(!['PENDING_REVIEW','CHANGES_REQUESTED'].includes(problem.rows[0].review_status)){
        await client.query('ROLLBACK');return res.status(409).json({error:'Only problems awaiting review can receive a new decision.'});
      }
      const nextStatus=decision==='APPROVED'?'PUBLISHED':decision;
      const updated=await client.query(
        `UPDATE public.problem SET review_status=$1,is_active=$2
         WHERE problem_id=$3 RETURNING problem_id,title,review_status,is_active`,
        [nextStatus,decision==='APPROVED',id]
      );
      const review=await client.query(
        `INSERT INTO public.problem_review(problem_id,reviewer_id,decision,comments)
         VALUES($1,$2,$3,$4) RETURNING review_id,reviewed_at`,
        [id,req.user.user_id,decision,comments||null]
      );
      await client.query(
        `INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'PROBLEM_REVIEWED','problem',$2,$3::jsonb)`,
        [req.user.user_id,String(id),JSON.stringify({decision,review_id:review.rows[0].review_id})]
      );
      await client.query('COMMIT');
      res.json({problem:updated.rows[0],review:review.rows[0]});
    } catch(error){
      await client.query('ROLLBACK');next(error);
    } finally {client.release();}
  });

  router.get('/admin/users', authRequired, allowRoles('Admin'), async (req,res,next) => {
    const roleId=req.query.roleId==null?null:positiveId(req.query.roleId);
    if(req.query.roleId!=null&&!roleId) return res.status(400).json({error:'Invalid role ID.'});
    const search=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';
    const includeInactive=req.query.includeInactive==='true';
    try {
      const [users,roles]=await Promise.all([
        pool.query(
          `SELECT u.user_id,u.name,u.email,u.joined_at,u.is_active,u.role_id,r.role_name,
                  o.organization_id,org.org_name,
                  EXISTS(SELECT 1 FROM public.learner l WHERE l.learner_id=u.user_id) AS has_learner_profile
           FROM public.users u JOIN public.role r ON r.role_id=u.role_id
           LEFT JOIN public.organizer o ON o.organizer_id=u.user_id
           LEFT JOIN public.organization org ON org.organization_id=o.organization_id
           WHERE ($1::boolean OR u.is_active=TRUE)
             AND ($2::integer IS NULL OR u.role_id=$2)
             AND ($3='' OR u.name ILIKE '%'||$3||'%' OR u.email ILIKE '%'||$3||'%')
           ORDER BY u.user_id LIMIT 200`,
          [includeInactive,roleId,search]
        ),
        pool.query('SELECT role_id,role_name,description FROM public.role ORDER BY role_id')
      ]);
      res.json({users:users.rows,roles:roles.rows});
    } catch(error){next(error);}
  });

  router.patch('/admin/users/:id', authRequired, allowRoles('Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    const roleId=req.body.role_id==null?null:positiveId(req.body.role_id);
    const hasRole=Object.prototype.hasOwnProperty.call(req.body,'role_id');
    const hasActive=Object.prototype.hasOwnProperty.call(req.body,'is_active');
    if(!id) return res.status(400).json({error:'Invalid user ID.'});
    if(!hasRole&&!hasActive) return res.status(400).json({error:'Provide role_id or is_active.'});
    if(hasRole&&!roleId) return res.status(400).json({error:'Invalid role ID.'});
    if(hasActive&&typeof req.body.is_active!=='boolean') return res.status(400).json({error:'is_active must be true or false.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const current=await client.query('SELECT user_id,role_id,is_active FROM public.users WHERE user_id=$1 FOR UPDATE',[id]);
      if(!current.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'User not found.'});}
      let targetRole=current.rows[0].role_id;
      let targetRoleName=null;
      if(hasRole){
        const role=await client.query('SELECT role_id,role_name FROM public.role WHERE role_id=$1',[roleId]);
        if(!role.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Role not found.'});}
        targetRole=roleId;targetRoleName=role.rows[0].role_name;
        const category=rolePrefix(targetRoleName);
        if(category==='Learner'){
          await client.query('INSERT INTO public.learner(learner_id,current_streak,solved_count) VALUES($1,0,0) ON CONFLICT(learner_id) DO NOTHING',[id]);
        }
        if(category==='Organizer'){
          const existing=await client.query('SELECT organizer_id FROM public.organizer WHERE organizer_id=$1',[id]);
          if(!existing.rowCount){
            const organizationId=positiveId(req.body.organization_id);
            if(!organizationId){await client.query('ROLLBACK');return res.status(400).json({error:'Assign a valid organization_id before changing this user to an Organizer role.'});}
            const organization=await client.query('SELECT 1 FROM public.organization WHERE organization_id=$1',[organizationId]);
            if(!organization.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Organization not found.'});}
            await client.query('INSERT INTO public.organizer(organizer_id,organization_id) VALUES($1,$2)',[id,organizationId]);
          }
        }
      }
      const updated=await client.query(
        `UPDATE public.users SET role_id=$1,is_active=$2 WHERE user_id=$3
         RETURNING user_id,name,email,role_id,is_active`,
        [targetRole,hasActive?req.body.is_active:current.rows[0].is_active,id]
      );
      const roleName=targetRoleName || (await client.query('SELECT role_name FROM public.role WHERE role_id=$1',[targetRole])).rows[0].role_name;
      await client.query(
        `INSERT INTO public.audit_log(actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'USER_ACCOUNT_UPDATED','user',$2,$3::jsonb)`,
        [req.user.user_id,String(id),JSON.stringify({role_id:targetRole,role_name:roleName,is_active:updated.rows[0].is_active})]
      );
      await client.query('COMMIT');
      res.json({user:{...updated.rows[0],role_name:roleName}});
    } catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/support/tickets', authRequired, async (req,res,next) => {
    const subject=typeof req.body.subject==='string'?req.body.subject.trim():'';
    const description=typeof req.body.description==='string'?req.body.description.trim():'';
    const priority=String(req.body.priority||'MEDIUM').toUpperCase();
    if(!subject||subject.length>160||!description||description.length>10000) return res.status(400).json({error:'Enter a subject (max 160 characters) and description (max 10000 characters).'});
    if(!['LOW','MEDIUM','HIGH','URGENT'].includes(priority)) return res.status(400).json({error:'Invalid ticket priority.'});
    try {
      const result=await pool.query(
        `INSERT INTO public.support_ticket(requester_id,subject,description,priority)
         VALUES($1,$2,$3,$4)
         RETURNING ticket_id,subject,description,priority,status,created_at`,
        [req.user.user_id,subject,description,priority]
      );
      await audit(req.user.user_id,'SUPPORT_TICKET_CREATED','support_ticket',result.rows[0].ticket_id,{priority});
      res.status(201).json({ticket:result.rows[0]});
    } catch(error){next(error);}
  });

  router.get('/support/tickets/mine', authRequired, async (req,res,next) => {
    try {
      const result=await pool.query(
        `SELECT ticket_id,subject,description,priority,status,created_at,updated_at,resolved_at
         FROM public.support_ticket WHERE requester_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [req.user.user_id]
      );
      res.json({tickets:result.rows});
    } catch(error){next(error);}
  });

  router.get('/support/tickets', authRequired, allowRoles('Support','Admin'), async (req,res,next) => {
    const status=typeof req.query.status==='string'?req.query.status.toUpperCase():'';
    if(status&&!['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'].includes(status)) return res.status(400).json({error:'Invalid ticket status.'});
    try {
      const result=await pool.query(
        `SELECT t.ticket_id,t.subject,t.description,t.priority,t.status,t.created_at,t.updated_at,
                requester.user_id AS requester_id,requester.name AS requester_name,
                support.user_id AS assigned_support_id,support.name AS assigned_support_name
         FROM public.support_ticket t
         LEFT JOIN public.users requester ON requester.user_id=t.requester_id
         LEFT JOIN public.users support ON support.user_id=t.assigned_support_id
         WHERE ($1='' OR t.status=$1)
         ORDER BY CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, t.created_at
         LIMIT 200`,[status]
      );
      res.json({tickets:result.rows});
    } catch(error){next(error);}
  });

  router.patch('/support/tickets/:id', authRequired, allowRoles('Support','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    const status=String(req.body.status||'').toUpperCase();
    const priority=req.body.priority==null?null:String(req.body.priority).toUpperCase();
    const assigned=req.body.assigned_support_id==null?null:positiveId(req.body.assigned_support_id);
    if(!id) return res.status(400).json({error:'Invalid ticket ID.'});
    if(status&&!['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'].includes(status)) return res.status(400).json({error:'Invalid ticket status.'});
    if(priority&&!['LOW','MEDIUM','HIGH','URGENT'].includes(priority)) return res.status(400).json({error:'Invalid ticket priority.'});
    if(req.body.assigned_support_id!=null&&!assigned) return res.status(400).json({error:'Invalid Support account ID.'});
    try {
      if(assigned){
        const support=await pool.query(
          `SELECT 1 FROM public.users u JOIN public.role r ON r.role_id=u.role_id
           WHERE u.user_id=$1 AND u.is_active=TRUE AND r.role_name LIKE 'Support L%'`,[assigned]
        );
        if(!support.rowCount) return res.status(400).json({error:'The assigned user must be an active Support account.'});
      }
      const result=await pool.query(
        `UPDATE public.support_ticket SET
           status=COALESCE(NULLIF($1,''),status),
           priority=COALESCE($2,priority),
           assigned_support_id=CASE WHEN $4::boolean THEN $3 ELSE assigned_support_id END,
           updated_at=CURRENT_TIMESTAMP,
           resolved_at=CASE WHEN COALESCE(NULLIF($1,''),status) IN ('RESOLVED','CLOSED') THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE ticket_id=$5
         RETURNING ticket_id,subject,priority,status,assigned_support_id,updated_at,resolved_at`,
        [status,priority,assigned,req.body.assigned_support_id!==undefined,id]
      );
      if(!result.rowCount) return res.status(404).json({error:'Support ticket not found.'});
      await audit(req.user.user_id,'SUPPORT_TICKET_UPDATED','support_ticket',id,{status:status||null,priority,assigned_support_id:assigned});
      res.json({ticket:result.rows[0]});
    } catch(error){next(error);}
  });

  router.post('/mentor/feedback', authRequired, allowRoles('Mentor','Admin'), async (req,res,next) => {
    const learnerId=positiveId(req.body.learner_id);
    const problemId=req.body.problem_id==null?null:positiveId(req.body.problem_id);
    const submissionId=req.body.submission_id==null?null:positiveId(req.body.submission_id);
    const feedback=typeof req.body.feedback==='string'?req.body.feedback.trim():'';
    if(!learnerId||!feedback||feedback.length>10000) return res.status(400).json({error:'A learner_id and feedback text (max 10000 characters) are required.'});
    if(req.body.problem_id!=null&&!problemId) return res.status(400).json({error:'Invalid problem ID.'});
    if(req.body.submission_id!=null&&!submissionId) return res.status(400).json({error:'Invalid submission ID.'});
    try {
      const learner=await pool.query('SELECT 1 FROM public.learner WHERE learner_id=$1',[learnerId]);
      if(!learner.rowCount) return res.status(404).json({error:'Learner profile not found.'});
      if(problemId){const p=await pool.query('SELECT 1 FROM public.problem WHERE problem_id=$1',[problemId]);if(!p.rowCount)return res.status(404).json({error:'Problem not found.'});}
      if(submissionId){
        const sub=await pool.query('SELECT problem_id FROM public.submission WHERE submission_id=$1 AND user_id=$2',[submissionId,learnerId]);
        if(!sub.rowCount) return res.status(404).json({error:'The selected submission does not belong to this learner.'});
      }
      const result=await pool.query(
        `INSERT INTO public.mentor_feedback(mentor_id,learner_id,problem_id,submission_id,feedback)
         VALUES($1,$2,$3,$4,$5)
         RETURNING feedback_id,mentor_id,learner_id,problem_id,submission_id,feedback,created_at`,
        [req.user.user_id,learnerId,problemId,submissionId,feedback]
      );
      await audit(req.user.user_id,'MENTOR_FEEDBACK_CREATED','mentor_feedback',result.rows[0].feedback_id,{learner_id:learnerId,problem_id:problemId,submission_id:submissionId});
      res.status(201).json({feedback:result.rows[0]});
    } catch(error){next(error);}
  });

  router.get('/mentor/feedback', authRequired, allowRoles('Mentor','Learner','Admin'), async (req,res,next) => {
    const learnerId=req.query.learnerId==null?null:positiveId(req.query.learnerId);
    if(req.query.learnerId!=null&&!learnerId) return res.status(400).json({error:'Invalid learner ID.'});
    try {
      let where='';let params=[];
      if(req.user.role_category==='Learner'){where='f.learner_id=$1';params=[req.user.user_id];}
      else if(req.user.role_category==='Mentor'){where='f.mentor_id=$1';params=[req.user.user_id];}
      else if(learnerId){where='f.learner_id=$1';params=[learnerId];}
      const result=await pool.query(
        `SELECT f.feedback_id,f.mentor_id,mentor.name AS mentor_name,f.learner_id,learner.name AS learner_name,
                f.problem_id,p.title AS problem_title,f.submission_id,f.feedback,f.created_at
         FROM public.mentor_feedback f
         JOIN public.users mentor ON mentor.user_id=f.mentor_id
         JOIN public.users learner ON learner.user_id=f.learner_id
         LEFT JOIN public.problem p ON p.problem_id=f.problem_id
         ${where?'WHERE '+where:''}
         ORDER BY f.created_at DESC LIMIT 200`,params
      );
      res.json({feedback:result.rows});
    } catch(error){next(error);}
  });

  router.get('/judge/contests/:id/reviews', authRequired, allowRoles('Judge','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    if(!id) return res.status(400).json({error:'Invalid contest ID.'});
    try {
      const contest=await pool.query('SELECT contest_id,name,start_time,end_time FROM public.contest WHERE contest_id=$1',[id]);
      if(!contest.rowCount) return res.status(404).json({error:'Contest not found.'});
      const [leaderboard,reviews]=await Promise.all([
        pool.query(
          `SELECT RANK() OVER(ORDER BY cr.score DESC,cr.penalty ASC,cr.registered_at ASC)::integer AS rank,
                  cr.learner_id,u.name AS learner_name,cr.score,cr.penalty,cr.registered_at
           FROM public.contest_registration cr JOIN public.users u ON u.user_id=cr.learner_id
           WHERE cr.contest_id=$1 ORDER BY cr.score DESC,cr.penalty ASC,cr.registered_at ASC`,[id]
        ),
        pool.query(
          `SELECT r.review_id,r.judge_id,u.name AS judge_name,r.decision,r.notes,r.reviewed_at
           FROM public.contest_result_review r JOIN public.users u ON u.user_id=r.judge_id
           WHERE r.contest_id=$1 ORDER BY r.reviewed_at DESC`,[id]
        )
      ]);
      res.json({contest:contest.rows[0],leaderboard:leaderboard.rows,reviews:reviews.rows});
    } catch(error){next(error);}
  });

  router.post('/judge/contests/:id/reviews', authRequired, allowRoles('Judge','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    const decision=String(req.body.decision||'').toUpperCase();
    const notes=typeof req.body.notes==='string'?req.body.notes.trim():'';
    if(!id) return res.status(400).json({error:'Invalid contest ID.'});
    if(!['APPROVED','FLAGGED'].includes(decision)) return res.status(400).json({error:'Choose APPROVED or FLAGGED.'});
    if(notes.length>5000) return res.status(400).json({error:'Notes must be 5000 characters or fewer.'});
    try {
      const contest=await pool.query('SELECT contest_id,end_time FROM public.contest WHERE contest_id=$1',[id]);
      if(!contest.rowCount) return res.status(404).json({error:'Contest not found.'});
      if(new Date(contest.rows[0].end_time).getTime()>Date.now()) return res.status(409).json({error:'Contest results can be validated only after the contest ends.'});
      const result=await pool.query(
        `INSERT INTO public.contest_result_review(contest_id,judge_id,decision,notes)
         VALUES($1,$2,$3,$4) RETURNING review_id,contest_id,judge_id,decision,notes,reviewed_at`,
        [id,req.user.user_id,decision,notes||null]
      );
      await audit(req.user.user_id,'CONTEST_RESULTS_REVIEWED','contest',id,{decision,review_id:result.rows[0].review_id});
      res.status(201).json({review:result.rows[0]});
    } catch(error){next(error);}
  });

  router.get('/assessments/:id/suspicious-activity', authRequired, allowRoles('Organizer','Admin'), async (req,res,next) => {
    const id=positiveId(req.params.id);
    if(!id) return res.status(400).json({error:'Invalid assessment ID.'});
    try {
      const scope=await organizationScope(req.user);
      if(!scope) return res.status(403).json({error:'An Organizer organization profile is required.'});
      const assessment=await pool.query('SELECT organization_id FROM public.assessment WHERE assessment_id=$1',[id]);
      if(!assessment.rowCount) return res.status(404).json({error:'Assessment not found.'});
      if(!scope.admin&&Number(assessment.rows[0].organization_id)!==Number(scope.organizationId)) return res.status(403).json({error:'You cannot access this organization assessment.'});
      const rows=await pool.query(
        `SELECT a.activity_id,a.candidate_id,c.name AS candidate_name,c.email AS candidate_email,
                a.event_type,a.metadata,a.detected_at,a.review_status,a.review_notes,
                a.reviewed_by,u.name AS reviewer_name
         FROM public.suspicious_activity a
         JOIN public.candidate c ON c.candidate_id=a.candidate_id
         LEFT JOIN public.users u ON u.user_id=a.reviewed_by
         WHERE a.assessment_id=$1 ORDER BY a.detected_at DESC`,[id]
      );
      res.json({activities:rows.rows,notice:'These are review indicators only, not proof of misconduct.'});
    } catch(error){next(error);}
  });

  router.patch('/assessments/:id/suspicious-activity/:activityId', authRequired, allowRoles('Organizer','Admin'), async (req,res,next) => {
    const assessmentId=positiveId(req.params.id);
    const activityId=positiveId(req.params.activityId);
    const status=String(req.body.review_status||'').toUpperCase();
    const notes=typeof req.body.review_notes==='string'?req.body.review_notes.trim():'';
    if(!assessmentId||!activityId) return res.status(400).json({error:'Invalid assessment or activity ID.'});
    if(!['REVIEWED','DISMISSED','PENDING'].includes(status)) return res.status(400).json({error:'Invalid review status.'});
    if(notes.length>5000) return res.status(400).json({error:'Review notes must be 5000 characters or fewer.'});
    try {
      const scope=await organizationScope(req.user);
      if(!scope) return res.status(403).json({error:'An Organizer organization profile is required.'});
      const assessment=await pool.query('SELECT organization_id FROM public.assessment WHERE assessment_id=$1',[assessmentId]);
      if(!assessment.rowCount) return res.status(404).json({error:'Assessment not found.'});
      if(!scope.admin&&Number(assessment.rows[0].organization_id)!==Number(scope.organizationId)) return res.status(403).json({error:'You cannot review activity for this organization.'});
      const updated=await pool.query(
        `UPDATE public.suspicious_activity SET review_status=$1,reviewed_by=$2,review_notes=$3
         WHERE activity_id=$4 AND assessment_id=$5
         RETURNING activity_id,review_status,reviewed_by,review_notes`,
        [status,req.user.user_id,notes||null,activityId,assessmentId]
      );
      if(!updated.rowCount) return res.status(404).json({error:'Activity indicator not found.'});
      await audit(req.user.user_id,'SUSPICIOUS_ACTIVITY_REVIEWED','suspicious_activity',activityId,{assessment_id:assessmentId,review_status:status});
      res.json({activity:updated.rows[0],notice:'A review indicator is not a finding of misconduct.'});
    } catch(error){next(error);}
  });

  router.get('/admin/audit', authRequired, allowRoles('Admin'), async (req,res,next) => {
    const entityType=typeof req.query.entityType==='string'?req.query.entityType.trim().slice(0,50):'';
    try {
      const result=await pool.query(
        `SELECT a.audit_id,a.actor_user_id,u.name AS actor_name,a.action,a.entity_type,a.entity_id,a.details,a.created_at
         FROM public.audit_log a LEFT JOIN public.users u ON u.user_id=a.actor_user_id
         WHERE ($1='' OR a.entity_type=$1)
         ORDER BY a.created_at DESC,a.audit_id DESC LIMIT 300`,[entityType]
      );
      res.json({events:result.rows});
    } catch(error){next(error);}
  });

  router.audit = audit;
  return router;
}
