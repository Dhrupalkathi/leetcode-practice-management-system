function safeText(value,maxLength) {
  return String(value ?? '').trim().slice(0,maxLength);
}

async function notifyUser(pool,userId,notification) {
  if(!Number.isSafeInteger(Number(userId))||Number(userId)<=0)return;
  const title=safeText(notification.title,160);
  const message=safeText(notification.message,2000);
  const type=safeText(notification.notification_type,40);
  if(!title||!message||!type)return;
  try {
    await pool.query(
      `INSERT INTO public.notification
        (user_id,notification_type,title,message,entity_type,entity_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        Number(userId),type,title,message,
        safeText(notification.entity_type,40)||null,
        notification.entity_id==null?null:safeText(notification.entity_id,80)
      ]
    );
  } catch(error) {
    console.error('In-app notification could not be stored:',error.message);
  }
}

async function notifyRoleCategories(pool,categories,notification) {
  const valid=Array.isArray(categories)?categories.filter((item)=>typeof item==='string'):[];
  if(!valid.length)return;
  const title=safeText(notification.title,160);
  const message=safeText(notification.message,2000);
  const type=safeText(notification.notification_type,40);
  if(!title||!message||!type)return;
  try {
    await pool.query(
      `INSERT INTO public.notification
        (user_id,notification_type,title,message,entity_type,entity_id)
       SELECT u.user_id,$2,$3,$4,$5,$6
       FROM public.users u
       JOIN public.role r ON r.role_id=u.role_id
       WHERE u.is_active=TRUE
         AND split_part(r.role_name,' L',1)=ANY($1::text[])`,
      [
        valid,type,title,message,
        safeText(notification.entity_type,40)||null,
        notification.entity_id==null?null:safeText(notification.entity_id,80)
      ]
    );
  } catch(error) {
    console.error('Role notification could not be stored:',error.message);
  }
}

module.exports={notifyUser,notifyRoleCategories};
