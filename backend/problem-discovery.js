const express = require('express');
const { notifyRoleCategories } = require('./notification-service');

function validateProblem(body) {
  const errors=[];
  const fields={};
  for(const field of ['title','problem_statement','input_format','output_format','difficulty']){
    if(typeof body[field]!=='string'||!body[field].trim()) errors.push(field+' is required.');
    else fields[field]=body[field].trim();
  }
  if(fields.title&&fields.title.length>150) errors.push('Title must be 150 characters or fewer.');
  if(!['Easy','Medium','Hard'].includes(fields.difficulty)) errors.push('Difficulty must be Easy, Medium, or Hard.');
  if(body.constraints!==undefined&&body.constraints!==null&&typeof body.constraints!=='string') errors.push('Constraints must be text or null.');
  fields.constraints=typeof body.constraints==='string'?body.constraints.trim():null;
  const topicIds=Array.isArray(body.topic_ids)?body.topic_ids.map(Number):[];
  if(!topicIds.length||topicIds.some((id)=>!Number.isSafeInteger(id)||id<=0)||new Set(topicIds).size!==topicIds.length){
    errors.push('Select at least one valid, unique topic.');
  }
  const testCases=Array.isArray(body.test_cases)?body.test_cases:[];
  if(testCases.length<1||testCases.length>100) errors.push('Add between 1 and 100 test cases.');
  for(let i=0;i<testCases.length;i++){
    const item=testCases[i];
    if(!item||typeof item.input_data!=='string'||typeof item.expected_output!=='string'){
      errors.push('Each test case needs input data and expected output.');
      break;
    }
    if(typeof item.is_hidden!=='boolean'){errors.push('Each test case must specify whether it is hidden.');break;}
    if(item.input_data.length>50000||item.expected_output.length>50000){errors.push('Each test case input/output must be 50000 characters or fewer.');break;}
  }
  return {errors,fields,topicIds,testCases};
}

module.exports = function createProblemDiscoveryRouter({ pool, authRequired, allowRoles, audit }) {
  const router = express.Router();

  router.get('/topics', async (req, res, next) => {
    try {
      const result = await pool.query('SELECT topic_id,name,description FROM public.topic ORDER BY name');
      res.json({topics:result.rows});
    } catch(error){next(error);}
  });

  router.get('/problem-organizers', authRequired, allowRoles('Admin'), async (req,res,next) => {
    try {
      const result=await pool.query(
        `SELECT o.organizer_id,u.name AS organizer_name,u.email,org.org_name AS organization_name
         FROM public.organizer o
         JOIN public.users u ON u.user_id=o.organizer_id
         JOIN public.organization org ON org.organization_id=o.organization_id
         WHERE u.is_active=TRUE
         ORDER BY org.org_name,u.name`
      );
      res.json({organizers:result.rows});
    } catch(error){next(error);}
  });

  router.get('/problems', (req,res,next) => {
    const includeInactive=req.query.includeInactive==='true';
    const sendProblems=async()=>{
      try {
        const result=await pool.query(
          `SELECT p.problem_id,p.title,p.problem_statement,p.input_format,p.output_format,
                  p.constraints,p.difficulty,p.is_active,p.review_status,p.created_at,p.created_by,
                  COALESCE((SELECT json_agg(json_build_object('topic_id',t.topic_id,'name',t.name) ORDER BY t.name)
                    FROM public.problem_topic pt JOIN public.topic t ON t.topic_id=pt.topic_id
                    WHERE pt.problem_id=p.problem_id),'[]'::json) AS topics
           FROM public.problem p
           WHERE p.is_active=TRUE
              OR ($1::boolean AND (
                   p.review_status='RETIRED'
                   OR (p.review_status IN ('PENDING_REVIEW','CHANGES_REQUESTED','REJECTED')
                       AND ($2::text IN ('Reviewer','Admin')
                            OR ($2::text='Organizer' AND p.created_by=$3::integer))
                   )
                 ))
           ORDER BY p.problem_id`,[includeInactive,req.user?.role_category||'',req.user?.organizer_id||null]
        );
        res.json({problems:result.rows});
      } catch(error){next(error);}
    };
    if(includeInactive) return authRequired(req,res,sendProblems);
    return sendProblems();
  });

  router.get('/problems/:id', async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    try {
      const result=await pool.query(
        `SELECT p.problem_id,p.title,p.problem_statement,p.input_format,p.output_format,
                p.constraints,p.difficulty,p.is_active,p.review_status,p.created_at,p.created_by,
                COALESCE((SELECT json_agg(json_build_object('topic_id',t.topic_id,'name',t.name,'description',t.description) ORDER BY t.name)
                  FROM public.problem_topic pt JOIN public.topic t ON t.topic_id=pt.topic_id
                  WHERE pt.problem_id=p.problem_id),'[]'::json) AS topics,
                COALESCE((SELECT json_agg(json_build_object('test_case_id',tc.test_case_id,'input_data',tc.input_data,'expected_output',tc.expected_output) ORDER BY tc.test_case_id)
                  FROM public.test_case tc WHERE tc.problem_id=p.problem_id AND tc.is_hidden=FALSE),'[]'::json) AS sample_tests
         FROM public.problem p WHERE p.problem_id=$1`,[id]
      );
      if(!result.rowCount) return res.status(404).json({error:'Problem not found.'});
      if(!result.rows[0].is_active) {
        return authRequired(req,res,()=>{
          const problem=result.rows[0];
          const reviewOnly=['PENDING_REVIEW','CHANGES_REQUESTED','REJECTED'].includes(problem.review_status);
          const allowed=!reviewOnly ||
            ['Reviewer','Admin'].includes(req.user.role_category) ||
            (req.user.role_category==='Organizer' && Number(req.user.organizer_id)===Number(problem.created_by));
          if(!allowed) return res.status(404).json({error:'Problem not found.'});
          return res.json({problem});
        });
      }
      res.json({problem:result.rows[0]});
    } catch(error){next(error);}
  });

  async function validateTopicIds(topicIds) {
    const result=await pool.query('SELECT topic_id FROM public.topic WHERE topic_id=ANY($1::integer[])',[topicIds]);
    return result.rowCount===topicIds.length;
  }

  async function addProblemRelations(client,problemId,topicIds,testCases) {
    for(const topicId of topicIds){
      await client.query('INSERT INTO public.problem_topic(problem_id,topic_id) VALUES($1,$2)',[problemId,topicId]);
    }
    for(let index=0;index<testCases.length;index++){
      const item=testCases[index];
      await client.query(
        `INSERT INTO public.test_case(problem_id,test_case_id,input_data,expected_output,is_hidden)
         VALUES($1,$2,$3,$4,$5)`,
        [problemId,index+1,item.input_data,item.expected_output,item.is_hidden]
      );
    }
  }

  router.get('/problems/:id/test-cases/manage', authRequired, allowRoles('Organizer','Reviewer','Admin'), async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    try {
      const problem=await pool.query('SELECT problem_id,created_by FROM public.problem WHERE problem_id=$1',[id]);
      if(!problem.rowCount) return res.status(404).json({error:'Problem not found.'});
      if(req.user.role_category==='Organizer'&&Number(req.user.organizer_id)!==Number(problem.rows[0].created_by)){
        return res.status(404).json({error:'Problem not found.'});
      }
      const [tests,topics,submissions]=await Promise.all([
        pool.query('SELECT test_case_id,input_data,expected_output,is_hidden FROM public.test_case WHERE problem_id=$1 ORDER BY test_case_id',[id]),
        pool.query('SELECT topic_id FROM public.problem_topic WHERE problem_id=$1 ORDER BY topic_id',[id]),
        pool.query('SELECT 1 FROM public.submission WHERE problem_id=$1 LIMIT 1',[id])
      ]);
      res.json({
        test_cases:tests.rows,
        topic_ids:topics.rows.map((row)=>row.topic_id),
        test_cases_locked:submissions.rowCount>0
      });
    } catch(error){next(error);}
  });

  router.post('/problems', authRequired, allowRoles('Organizer','Admin'), async (req,res,next) => {
    const input=validateProblem(req.body);
    if(input.errors.length) return res.status(400).json({error:'Validation failed.',details:input.errors});
    const creatorOrganizerId=req.user.role_category==='Admin'
      ? Number(req.body.organizer_id)
      : req.user.organizer_id;
    if(!Number.isSafeInteger(creatorOrganizerId)||creatorOrganizerId<=0) {
      return res.status(400).json({error:'Select an active Organizer owner for this problem.'});
    }
    const owner=await pool.query(
      `SELECT o.organizer_id FROM public.organizer o
       JOIN public.users u ON u.user_id=o.organizer_id
       WHERE o.organizer_id=$1 AND u.is_active=TRUE`,
      [creatorOrganizerId]
    );
    if(!owner.rowCount) return res.status(400).json({error:'Selected Organizer owner does not exist or is inactive.'});
    const topicsValid=await validateTopicIds(input.topicIds);
    if(!topicsValid) return res.status(400).json({error:'One or more selected topics do not exist.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const created=await client.query(
        `INSERT INTO public.problem
          (title,problem_statement,input_format,output_format,constraints,difficulty,created_by,is_active,review_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,FALSE,'PENDING_REVIEW')
         RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                   difficulty,is_active,review_status,created_at,created_by`,
        [input.fields.title,input.fields.problem_statement,input.fields.input_format,input.fields.output_format,
         input.fields.constraints,input.fields.difficulty,req.user.organizer_id]
      );
      await addProblemRelations(client,created.rows[0].problem_id,input.topicIds,input.testCases);
      await client.query('COMMIT');
      if(audit) await audit(req.user.user_id,'PROBLEM_SUBMITTED_FOR_REVIEW','problem',created.rows[0].problem_id,{title:created.rows[0].title,organizer_owner_id:creatorOrganizerId,topic_ids:input.topicIds,test_case_count:input.testCases.length});
      await notifyRoleCategories(pool,['Reviewer','Admin'],{notification_type:'PROBLEM_REVIEW',title:'Problem awaiting review',message:'Problem #'+created.rows[0].problem_id+' · '+created.rows[0].title+' was submitted for review.',entity_type:'problem',entity_id:created.rows[0].problem_id});
      res.status(201).json({problem:created.rows[0],message:'Problem and test cases submitted for Reviewer approval.'});
    } catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505') return res.status(409).json({error:'A problem with that title already exists.'});
      next(error);
    } finally {client.release();}
  });

  router.put('/problems/:id', authRequired, allowRoles('Organizer','Admin'), async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    const input=validateProblem(req.body);
    if(input.errors.length) return res.status(400).json({error:'Validation failed.',details:input.errors});
    if(!await validateTopicIds(input.topicIds)) return res.status(400).json({error:'One or more selected topics do not exist.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const current=await client.query(
        `SELECT problem_id,created_by FROM public.problem WHERE problem_id=$1
         AND ($2::text='Admin' OR created_by=$3::integer) FOR UPDATE`,
        [id,req.user.role_category,req.user.organizer_id]
      );
      if(!current.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Problem not found.'});}
      const existingTests=await client.query(
        'SELECT test_case_id,input_data,expected_output,is_hidden FROM public.test_case WHERE problem_id=$1 ORDER BY test_case_id',[id]
      );
      const submissions=await client.query('SELECT 1 FROM public.submission WHERE problem_id=$1 LIMIT 1',[id]);
      const sameTests=JSON.stringify(existingTests.rows.map((row)=>({input_data:row.input_data,expected_output:row.expected_output,is_hidden:row.is_hidden})))===
        JSON.stringify(input.testCases.map((row)=>({input_data:row.input_data,expected_output:row.expected_output,is_hidden:row.is_hidden})));
      if(submissions.rowCount&&!sameTests){
        await client.query('ROLLBACK');
        return res.status(409).json({error:'Test cases are locked because this problem has submission history. Create a new problem version instead of changing past judging data.'});
      }
      const updated=await client.query(
        `UPDATE public.problem
         SET title=$1,problem_statement=$2,input_format=$3,output_format=$4,
             constraints=$5,difficulty=$6,is_active=FALSE,review_status='PENDING_REVIEW'
         WHERE problem_id=$7
         RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                   difficulty,is_active,review_status,created_at,created_by`,
        [input.fields.title,input.fields.problem_statement,input.fields.input_format,input.fields.output_format,
         input.fields.constraints,input.fields.difficulty,id]
      );
      await client.query('DELETE FROM public.problem_topic WHERE problem_id=$1',[id]);
      for(const topicId of input.topicIds){
        await client.query('INSERT INTO public.problem_topic(problem_id,topic_id) VALUES($1,$2)',[id,topicId]);
      }
      if(!submissions.rowCount){
        await client.query('DELETE FROM public.test_case WHERE problem_id=$1',[id]);
        for(let index=0;index<input.testCases.length;index++){
          const item=input.testCases[index];
          await client.query(
            'INSERT INTO public.test_case(problem_id,test_case_id,input_data,expected_output,is_hidden) VALUES($1,$2,$3,$4,$5)',
            [id,index+1,item.input_data,item.expected_output,item.is_hidden]
          );
        }
      }
      await client.query('COMMIT');
      if(audit) await audit(req.user.user_id,'PROBLEM_UPDATE_SUBMITTED_FOR_REVIEW','problem',id,{title:updated.rows[0].title,topic_ids:input.topicIds,test_case_count:input.testCases.length});
      await notifyRoleCategories(pool,['Reviewer','Admin'],{notification_type:'PROBLEM_REVIEW',title:'Problem update awaiting review',message:'Problem #'+id+' · '+updated.rows[0].title+' was resubmitted for review.',entity_type:'problem',entity_id:id});
      res.json({problem:updated.rows[0],message:'Problem content and topics saved; sent for Reviewer approval.'});
    } catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505') return res.status(409).json({error:'A problem with that title already exists.'});
      next(error);
    } finally {client.release();}
  });

  router.patch('/problems/:id/retire', authRequired, allowRoles('Organizer','Admin'), async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    try {
      const result=await pool.query(
        `UPDATE public.problem SET is_active=FALSE,review_status='RETIRED'
         WHERE problem_id=$1 AND ($2::text='Admin' OR created_by=$3::integer)
         RETURNING problem_id,title,is_active,review_status`,[id,req.user.role_category,req.user.organizer_id]
      );
      if(!result.rowCount) return res.status(404).json({error:'Problem not found.'});
      if(audit) await audit(req.user.user_id,'PROBLEM_RETIRED','problem',id,{title:result.rows[0].title});
      res.json({problem:result.rows[0],message:'Problem retired. Related history was preserved.'});
    } catch(error){next(error);}
  });

  return router;
}
