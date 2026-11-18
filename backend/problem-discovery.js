const express = require('express');
const { notifyRoleCategories } = require('./notification-service');

function validateProblem(body) {
  const errors=[];
  const fields={};
  const questionType=String(body.question_type||'CODING').toUpperCase();
  const supported=['CODING','MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE','SHORT_ANSWER','FILL_BLANK','SQL'];
  if(!supported.includes(questionType)) errors.push('Choose a supported question type.');
  for(const field of ['title','problem_statement','difficulty']){
    if(typeof body[field]!=='string'||!body[field].trim()) errors.push(field+' is required.');
    else fields[field]=body[field].trim();
  }
  if(fields.title&&fields.title.length>150) errors.push('Title must be 150 characters or fewer.');
  if(!['Easy','Medium','Hard'].includes(fields.difficulty)) errors.push('Difficulty must be Easy, Medium, or Hard.');
  for(const field of ['input_format','output_format']) {
    if(questionType==='CODING' && (typeof body[field]!=='string'||!body[field].trim())) errors.push(field+' is required for coding questions.');
    fields[field]=typeof body[field]==='string'?body[field].trim():'';
  }
  if(body.constraints!==undefined&&body.constraints!==null&&typeof body.constraints!=='string') errors.push('Constraints must be text or null.');
  fields.constraints=typeof body.constraints==='string'?body.constraints.trim():null;
  const topicIds=Array.isArray(body.topic_ids)?body.topic_ids.map(Number):[];
  if(topicIds.some((id)=>!Number.isSafeInteger(id)||id<=0)||new Set(topicIds).size!==topicIds.length) errors.push('Choose valid, unique topics.');
  const testCases=Array.isArray(body.test_cases)?body.test_cases:[];
  if(questionType==='CODING'&&(testCases.length<1||testCases.length>100)) errors.push('Add between 1 and 100 test cases for a coding question.');
  for(let i=0;i<testCases.length;i++){
    const item=testCases[i];
    if(!item||typeof item.input_data!=='string'||typeof item.expected_output!=='string'){errors.push('Each test case needs input data and expected output.');break;}
    if(typeof item.is_hidden!=='boolean'){errors.push('Each test case must specify whether it is hidden.');break;}
    if(item.input_data.length>50000||item.expected_output.length>50000){errors.push('Each test case input/output must be 50000 characters or fewer.');break;}
  }
  const config=body.question_config&&typeof body.question_config==='object'&&!Array.isArray(body.question_config)?body.question_config:{};
  let answerKey=body.answer_key;
  if(['MCQ_SINGLE','MCQ_MULTI'].includes(questionType)){
    const options=Array.isArray(config.options)?config.options.map(v=>String(v).trim()).filter(Boolean):[];
    if(options.length<2||options.length>10) errors.push('Add between 2 and 10 answer options.');
    if(questionType==='MCQ_SINGLE'&&typeof answerKey!=='string') errors.push('Choose the correct option for this single-choice question.');
    if(questionType==='MCQ_MULTI'&&(!Array.isArray(answerKey)||!answerKey.length)) errors.push('Choose at least one correct option.');
    if(typeof answerKey==='string'&&!options.includes(answerKey)) errors.push('The correct answer must match an option.');
    if(Array.isArray(answerKey)&&answerKey.some(v=>!options.includes(v))) errors.push('Every correct answer must match an option.');
    config.options=options;
  } else if(questionType==='TRUE_FALSE') {
    if(typeof answerKey!=='boolean') errors.push('Choose True or False as the correct answer.');
  } else if(['SHORT_ANSWER','FILL_BLANK'].includes(questionType)) {
    if(typeof answerKey!=='string'||!answerKey.trim()) errors.push('Provide the expected answer for automatic checking.');
    else answerKey=answerKey.trim();
  } else if(questionType==='SQL') {
    if(typeof config.expected_result!=='string'||!config.expected_result.trim()) errors.push('Provide the expected SQL result or explain the manual marking criteria.');
    answerKey={expected_result:String(config.expected_result||'').trim()};
  }
  if(questionType==='CODING') answerKey=null;
  // question_config is public; keep expected SQL results only in the private answer-key table.
  if(questionType==='SQL') delete config.expected_result;
  return {errors,fields,topicIds,testCases,questionType,config,answerKey};
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
         LEFT JOIN public.organization org ON org.organization_id=o.organization_id
         WHERE u.is_active=TRUE
         ORDER BY COALESCE(org.org_name,'Unassigned organization'),u.name`
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
                  p.constraints,p.difficulty,p.is_active,p.review_status,p.created_at,p.created_by,p.question_type,p.question_config,
                  COALESCE((SELECT json_agg(json_build_object('topic_id',t.topic_id,'name',t.name) ORDER BY t.name)
                    FROM public.problem_topic pt JOIN public.topic t ON t.topic_id=pt.topic_id
                    WHERE pt.problem_id=p.problem_id),'[]'::json) AS topics
           FROM public.problem p
           WHERE p.is_active=TRUE
              OR ($1::boolean AND (
                   p.review_status IN ('RETIRED','PENDING_REVIEW','CHANGES_REQUESTED','REJECTED')
                   AND ($2::text IN ('Reviewer','Admin')
                        OR ($2::text='Organizer' AND p.created_by=$3::integer))
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
          const allowed=
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

  router.post('/problems', authRequired, async (req,res,next) => {
    const input=validateProblem(req.body);
    if(input.errors.length) return res.status(400).json({error:'Validation failed.',details:input.errors});
    let creatorOrganizerId=null;
    if(req.user.role_category==='Organizer') creatorOrganizerId=req.user.organizer_id;
    if(req.user.role_category==='Admin'&&req.body.organizer_id) creatorOrganizerId=Number(req.body.organizer_id);
    if(creatorOrganizerId!==null) {
      if(!Number.isSafeInteger(creatorOrganizerId)||creatorOrganizerId<=0) return res.status(400).json({error:'Select a valid Organizer owner.'});
      const owner=await pool.query(
        `SELECT o.organizer_id FROM public.organizer o JOIN public.users u ON u.user_id=o.organizer_id
         WHERE o.organizer_id=$1 AND u.is_active=TRUE`,[creatorOrganizerId]);
      if(!owner.rowCount) return res.status(400).json({error:'Selected Organizer owner does not exist or is inactive.'});
    }
    const topicsValid=input.topicIds.length===0 || await validateTopicIds(input.topicIds);
    if(!topicsValid) return res.status(400).json({error:'One or more selected topics do not exist.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const created=await client.query(
        `INSERT INTO public.problem
          (title,problem_statement,input_format,output_format,constraints,difficulty,created_by,
           is_active,review_status,question_type,question_config,submitted_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,FALSE,'PENDING_REVIEW',$8,$9::jsonb,$10)
         RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                   difficulty,is_active,review_status,created_at,created_by,question_type,question_config`,
        [input.fields.title,input.fields.problem_statement,input.fields.input_format,input.fields.output_format,
         input.fields.constraints,input.fields.difficulty,creatorOrganizerId,input.questionType,
         JSON.stringify(input.config),req.user.user_id]
      );
      if(input.questionType==='CODING') await addProblemRelations(client,created.rows[0].problem_id,input.topicIds,input.testCases);
      else {
        for(const topicId of input.topicIds) await client.query('INSERT INTO public.problem_topic(problem_id,topic_id) VALUES($1,$2)',[created.rows[0].problem_id,topicId]);
        await client.query('INSERT INTO public.problem_answer_key(problem_id,answer_key) VALUES($1,$2::jsonb)',[created.rows[0].problem_id,JSON.stringify(input.answerKey)]);
      }
      await client.query('COMMIT');
      if(audit) await audit(req.user.user_id,'PROBLEM_SUBMITTED_FOR_REVIEW','problem',created.rows[0].problem_id,{title:created.rows[0].title,organizer_owner_id:creatorOrganizerId,submitted_by_user_id:req.user.user_id,question_type:input.questionType,topic_ids:input.topicIds,test_case_count:input.testCases.length});
      await notifyRoleCategories(pool,['Reviewer','Admin'],{notification_type:'PROBLEM_REVIEW',title:'Problem awaiting review',message:'Problem #'+created.rows[0].problem_id+' · '+created.rows[0].title+' was submitted for review.',entity_type:'problem',entity_id:created.rows[0].problem_id});
      res.status(201).json({problem:created.rows[0],message:'Question submitted for Reviewer approval.'});
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

  router.post('/questions/:id/answers', authRequired, async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid question ID.'});
    const answer=req.body?.answer;
    if(answer===undefined||answer===null||String(answer).trim()==='') return res.status(400).json({error:'Enter an answer before submitting.'});
    try {
      const question=await pool.query(
        `SELECT p.problem_id,p.question_type,p.question_config,k.answer_key
         FROM public.problem p LEFT JOIN public.problem_answer_key k ON k.problem_id=p.problem_id
         WHERE p.problem_id=$1 AND p.is_active=TRUE`,[id]);
      if(!question.rowCount) return res.status(404).json({error:'Active question not found.'});
      const q=question.rows[0];
      if(q.question_type==='CODING') return res.status(400).json({error:'Use the code editor for coding questions.'});
      let correct=null,review='PENDING_REVIEW',feedback='Your response was submitted for review.';
      const normalize=v=>String(v??'').trim().replace(/\\s+/g,' ').toLocaleLowerCase();
      if(['MCQ_SINGLE','TRUE_FALSE'].includes(q.question_type)) {
        correct=normalize(answer)===normalize(q.answer_key);
      } else if(q.question_type==='MCQ_MULTI') {
        const submitted=Array.isArray(answer)?answer.map(normalize).sort():[];
        const expected=Array.isArray(q.answer_key)?q.answer_key.map(normalize).sort():[];
        correct=submitted.length===expected.length&&submitted.every((v,i)=>v===expected[i]);
      } else if(['SHORT_ANSWER','FILL_BLANK'].includes(q.question_type)) {
        const expected=Array.isArray(q.answer_key)?q.answer_key:[q.answer_key];
        correct=expected.some(v=>normalize(v)===normalize(answer));
      } else if(q.question_type==='SQL') {
        correct=null;
      }
      if(correct!==null){review='AUTO_GRADED';feedback=correct?'Correct answer.':'Not quite. Review the question and try again.';}
      const saved=await pool.query(
        `INSERT INTO public.question_attempt(problem_id,user_id,answer,is_correct,review_status,feedback)
         VALUES($1,$2,$3::jsonb,$4,$5,$6) RETURNING question_attempt_id,submitted_at,is_correct,review_status,feedback`,
        [id,req.user.user_id,JSON.stringify(answer),correct,review,feedback]);
      res.status(201).json({attempt:saved.rows[0]});
    } catch(error){next(error);}
  });

  return router;
}
