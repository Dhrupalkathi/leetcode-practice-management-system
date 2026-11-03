const express = require('express');

function validId(value) {
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}

module.exports=function createNotificationRouter({pool,authRequired}) {
  const router=express.Router();

  router.get('/notifications',authRequired,async(req,res,next)=>{
    try {
      const [items,count]=await Promise.all([
        pool.query(
          `SELECT notification_id,notification_type,title,message,entity_type,entity_id,
                  is_read,created_at
           FROM public.notification
           WHERE user_id=$1
           ORDER BY created_at DESC,notification_id DESC
           LIMIT 30`,
          [req.user.user_id]
        ),
        pool.query(
          'SELECT COUNT(*)::integer AS unread_count FROM public.notification WHERE user_id=$1 AND is_read=FALSE',
          [req.user.user_id]
        )
      ]);
      res.json({notifications:items.rows,unread_count:count.rows[0].unread_count});
    } catch(error){next(error);}
  });

  router.patch('/notifications/:id/read',authRequired,async(req,res,next)=>{
    const id=validId(req.params.id);
    if(!id)return res.status(400).json({error:'Invalid notification ID.'});
    try {
      const result=await pool.query(
        `UPDATE public.notification
         SET is_read=TRUE
         WHERE notification_id=$1 AND user_id=$2
         RETURNING notification_id,is_read`,
        [id,req.user.user_id]
      );
      if(!result.rowCount)return res.status(404).json({error:'Notification not found.'});
      res.json({notification:result.rows[0]});
    } catch(error){next(error);}
  });

  router.patch('/notifications/read-all',authRequired,async(req,res,next)=>{
    try {
      const result=await pool.query(
        'UPDATE public.notification SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE',
        [req.user.user_id]
      );
      res.json({updated_count:result.rowCount});
    } catch(error){next(error);}
  });

  return router;
};
