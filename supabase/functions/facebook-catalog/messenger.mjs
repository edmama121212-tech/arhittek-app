// Facebook Messenger incoming messages. Only Facebook Page events, never Instagram.
export async function handleMessengerEntry(entry,{
  pageId,token,version,send,rpc,catalog,now,response
}){
  for(const event of entry.messaging||[]){
    const sender=String(event?.sender?.id||'');
    const recipient=String(event?.recipient?.id||'');
    const incoming=event?.message;
    const mid=String(incoming?.mid||'');
    if(recipient!==pageId||sender===pageId||!/^[0-9]{1,100}$/.test(sender)||
       !mid||mid.length>200||incoming?.is_echo||incoming?.is_deleted||
       !incoming||(!incoming.text&&!incoming.attachments)||
       event?.delivery||event?.read||event?.postback||event?.optin)continue;
    const eventTime=Number(event.timestamp);
    if(!Number.isFinite(eventTime)||eventTime<now()-24*3600000||eventTime>now()+300000)continue;
    const job=await rpc('claim_facebook_message_catalog_reply',{
      p_page:pageId,p_sender:sender,p_incoming_mid:mid,
      p_event_time:new Date(eventTime).toISOString()
    });
    if(!job?.claimed){if(job?.state==='sending')return response('Delivery in progress',503);continue;}
    const finish=(state,message=null,error=null)=>rpc('finish_facebook_message_catalog_reply',{
      p_page:pageId,p_sender:sender,p_lease:job.lease,
      p_state:state,p_sent_mid:message,p_error:error
    });
    let link;
    try{link=await catalog('messenger-'+sender,'message');}
    catch(_){await finish('pending',null,'Catalog unavailable');return response('Catalog unavailable',503);}
    const greeting='Здравствуйте! 🏡\n\nСпасибо, что написали ARHITTEK. Подготовили для вас каталог проектов частных домов с планировками и ценами.\n\nСсылка действует 48 часов.';
    let sent;
    try{
      sent=await send('https://graph.facebook.com/'+version+'/'+pageId+'/messages',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({
          recipient:{id:sender},messaging_type:'RESPONSE',
          message:{attachment:{type:'template',payload:{
            template_type:'button',text:greeting,
            buttons:[{type:'web_url',title:'Открыть каталог',url:link.url}]
          }}}
        })
      });
    }catch(_){await finish('uncertain',null,'Ambiguous network response');return response('Reconciliation required',503);}
    const data=await sent.json().catch(()=>null);
    if(sent.ok&&data?.message_id){
      const confirmed=await rpc('confirm_facebook_report_delivery',{
        p_page:pageId,p_channel:'messenger',p_event:mid,p_sender:sender,p_text:String(incoming.text||'').slice(0,500),
        p_lease:job.lease,p_message:String(data.message_id),p_expires_at:link.expiresAt
      });
      if(!confirmed)return response('Delivery reconciliation required',503);
      continue;
    }
    const pending=sent.status===429;
    await finish(pending?'pending':sent.status>=500||sent.ok?'uncertain':'failed',
      null,'Meta status '+sent.status+' code '+String(data?.error?.code||'unknown'));
    if(pending||sent.status>=500||sent.ok)return response('Delivery not confirmed',503);
  }
  return null;
}
