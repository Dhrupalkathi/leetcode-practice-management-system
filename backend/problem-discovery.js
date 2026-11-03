const express = require('express');

function validProblem(body) {
  const errors=[];
  for(const field of ['title','problem_statement','input_format','output_format','difficulty']){
    if(typeof body[field]!=='string'||!body[field].trim()) errors.push(field+' is required.');
  }
  if(typeof body.title==='string'&&body.title.trim().length>150) errors.push('Title must be 150 characters or fewer.');
  if(!['Easy','Medium','Hard'].includes(body.difficulty)) errors.push('Difficulty must be Easy, Medium, or Hard.');
  if(body.constraints!==undefined&&body.constraints!==null&&typeof body.constraints!=='string') errors.push('Constraints must be text or null.');
  return errors;
}

module.exports = function createProblemDiscoveryRouter({ pool, authRequired, allowRoles, audit }) {
  const router = express.Router();

  router.get('/topics', async (req, res, next) => {
    try {
      const result = await pool.query('SELECT topic_id,name,description FROM public.topic ORDER BY name');
      res.json({topics:result.rows});
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
           WHERE ($1::boolean OR p.is_active=TRUE)
           ORDER BY p.problem_id`,[includeInactive]
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
      if(!result.rows[0].is_active) return authRequired(req,res,()=>res.json({problem:result.rows[0]}));
      res.json({problem:result.rows[0]});
    } catch(error){next(error);}
  });

  router.post('/problems', authRequired, allowRoles('Organizer'), async (req,res,next) => {
    const errors=validProblem(req.body);
    if(errors.length) return res.status(400).json({error:'Validation failed.',details:errors});
    if(!req.user.organizer_id) return res.status(403).json({error:'Organizer profile is missing.'});
    try {
      const result=await pool.query(
        `INSERT INTO public.problem
          (title,problem_statement,input_format,output_format,constraints,difficulty,created_by,is_active,review_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,FALSE,'PENDING_REVIEW')
         RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                   difficulty,is_active,review_status,created_at,created_by`,
        [req.body.title.trim(),req.body.problem_statement.trim(),req.body.input_format.trim(),
         req.body.output_format.trim(),req.body.constraints?.trim()||null,req.body.difficulty,req.user.organizer_id]
      );
      if(audit) await audit(req.user.user_id,'PROBLEM_SUBMITTED_FOR_REVIEW','problem',result.rows[0].problem_id,{title:result.rows[0].title});
      res.status(201).json({problem:result.rows[0],message:'Problem submitted for Reviewer approval.'});
    } catch(error){
      if(error.code==='23505') return res.status(409).json({error:'A problem with that title already exists.'});
      next(error);
    }
  });

  router.put('/problems/:id', authRequired, allowRoles('Organizer'), async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    const errors=validProblem(req.body);
    if(errors.length) return res.status(400).json({error:'Validation failed.',details:errors});
    try {
      const result=await pool.query(
        `UPDATE public.problem
         SET title=$1,problem_statement=$2,input_format=$3,output_format=$4,
             constraints=$5,difficulty=$6,is_active=FALSE,review_status='PENDING_REVIEW'
         WHERE problem_id=$7
         RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                   difficulty,is_active,review_status,created_at,created_by`,
        [req.body.title.trim(),req.body.problem_statement.trim(),req.body.input_format.trim(),
         req.body.output_format.trim(),req.body.constraints?.trim()||null,req.body.difficulty,id]
      );
      if(!result.rowCount) return res.status(404).json({error:'Problem not found.'});
      if(audit) await audit(req.user.user_id,'PROBLEM_UPDATE_SUBMITTED_FOR_REVIEW','problem',id,{title:result.rows[0].title});
      res.json({problem:result.rows[0],message:'Changes saved and sent for Reviewer approval.'});
    } catch(error){
      if(error.code==='23505') return res.status(409).json({error:'A problem with that title already exists.'});
      next(error);
    }
  });

  router.patch('/problems/:id/retire', authRequired, allowRoles('Organizer'), async (req,res,next) => {
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:'Invalid problem ID.'});
    try {
      const result=await pool.query(
        `UPDATE public.problem SET is_active=FALSE,review_status='RETIRED'
         WHERE problem_id=$1 RETURNING problem_id,title,is_active,review_status`,[id]
      );
      if(!result.rowCount) return res.status(404).json({error:'Problem not found.'});
      if(audit) await audit(req.user.user_id,'PROBLEM_RETIRED','problem',id,{title:result.rows[0].title});
      res.json({problem:result.rows[0],message:'Problem retired. Related history was preserved.'});
    } catch(error){next(error);}
  });

  return router;
}
