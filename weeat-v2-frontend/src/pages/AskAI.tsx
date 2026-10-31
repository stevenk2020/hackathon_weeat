import { useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus,Brain,History,Send,Bookmark,Sparkles,Wallet,MapPin,FileText,Utensils,Trash2 } from 'lucide-react';
import { useApp } from '../services/AppContext';
import { useI18n } from '../i18n';
import { api } from '../services/api';
import { streamAsk } from '../services/askStream';
import { isMock } from '../services/config';
import { identity } from '../services/domain';
import { errorKey } from '../services/errors';
import type { ChatSession } from '../types';
import { RestaurantCard } from '../components/RestaurantCard';
import { ChatText } from '../components/ChatText';
import { MemoryManager } from '../components/MemoryManager';
import { Button,ErrorNotice } from '../components/ui';
export default function AskAI(){const app=useApp(),{t}=useI18n(),[draft,setDraft]=useState(''),[pending,setPending]=useState(false),[phase,setPhase]=useState<'searching'|'answering'>('searching'),[error,setError]=useState(''),[history,setHistory]=useState(false),[memory,setMemory]=useState(false),[confirmChat,setConfirmChat]=useState<string|null>(null),[deletingChat,setDeletingChat]=useState(false),[deleteError,setDeleteError]=useState('');const inFlight=useRef(false),streamController=useRef<AbortController|null>(null),memoryTrigger=useRef<HTMLButtonElement|null>(null),revision=useRef(0),sessionRevision=useRef(0),mounted=useRef(true),appRef=useRef(app);appRef.current=app;const active=app.sessions.find(s=>s.id===app.activeSession),saved=app.restaurants.filter(r=>r.is_saved===1);
  const newChat=()=>{streamController.current?.abort();sessionRevision.current++;revision.current++;const sessions=appRef.current.sessions.filter(item=>!item.id.startsWith('pending-'));if(sessions.length!==appRef.current.sessions.length)appRef.current.updateSessions(sessions,null);else appRef.current.setActiveSession(null);setDraft('');setError('');setHistory(false);};
  const closeMemory=()=>{setMemory(false);requestAnimationFrame(()=>memoryTrigger.current?.focus());};
  useEffect(()=>{mounted.current=true;const open=()=>setMemory(true);window.addEventListener('weeat-new-chat',newChat);window.addEventListener('weeat-open-memory',open);return()=>{mounted.current=false;sessionRevision.current++;streamController.current?.abort();window.removeEventListener('weeat-new-chat',newChat);window.removeEventListener('weeat-open-memory',open);};},[]);
  useEffect(()=>()=>streamController.current?.abort(),[app.user?.uid]);
  async function send(text=draft){
    const message=text.trim();
    if(!message||message.length>1000||inFlight.current||!app.user)return;
    const captured=text,uid=app.user.uid,session=app.activeSession,sr=sessionRevision.current,dr=++revision.current;
    inFlight.current=true;setDraft('');setPending(true);setPhase('searching');setError('');
    if(isMock){
      try{const result=await api.ask(app.user,message,session||undefined);if(!mounted.current||appRef.current.user?.uid!==uid||sessionRevision.current!==sr)return;const now=new Date().toISOString(),old=appRef.current.sessions.find(s=>s.id===result.session_id);const next:ChatSession={id:result.session_id,uid,title:old?.title||message.slice(0,60),created_at:old?.created_at||now,updated_at:now,messages:[...(old?.messages||[]),{id:crypto.randomUUID(),role:'user',content:message,created_at:now},{id:crypto.randomUUID(),role:'assistant',content:result.answer,references:result.references,demo:result.demo,created_at:now}]};appRef.current.updateSessions([next,...appRef.current.sessions.filter(s=>s.id!==next.id)],next.id);}catch(e){if(mounted.current&&appRef.current.user?.uid===uid&&sessionRevision.current===sr){setError(errorKey(e));if(revision.current===dr)setDraft(captured);}}finally{inFlight.current=false;if(mounted.current)setPending(false);}
      return;
    }
    const controller=new AbortController();streamController.current=controller;
    const now=new Date().toISOString(),temporaryId=`pending-${crypto.randomUUID()}`;
    const old=appRef.current.sessions.find(s=>s.id===session);
    const assistantId=crypto.randomUUID();
    let hasServerSession=Boolean(old),hasText=false;
    let current:ChatSession={id:old?.id||temporaryId,uid,title:old?.title||message.slice(0,60),created_at:old?.created_at||now,updated_at:now,messages:[...(old?.messages||[]),{id:crypto.randomUUID(),role:'user',content:message,created_at:now},{id:assistantId,role:'assistant',content:'',created_at:now}]};
    const valid=()=>mounted.current&&appRef.current.user?.uid===uid&&sessionRevision.current===sr;
    const publish=()=>{if(valid())appRef.current.updateSessions([current,...appRef.current.sessions.filter(s=>s.id!==current.id&&s.id!==temporaryId)],current.id);};
    const updateAssistant=(patch:(item:ChatSession['messages'][number])=>ChatSession['messages'][number])=>{current={...current,updated_at:new Date().toISOString(),messages:current.messages.map(item=>item.id===assistantId?patch(item):item)};publish();};
    publish();
    try{
      await streamAsk({message,...(session?{session_id:session}:{})},event=>{
        if(!valid())return;
        if(event.type==='session'){hasServerSession=true;current={...current,id:event.session_id};publish();}
        if(event.type==='status')setPhase(event.state==='answering'?'answering':'searching');
        if(event.type==='delta'){hasText=true;setPhase('answering');updateAssistant(item=>({...item,content:item.content+event.text}));}
        if(event.type==='references')updateAssistant(item=>({...item,references:event.references}));
      },controller.signal);
    }catch(e){
      if(valid()){
        if(!hasServerSession){appRef.current.updateSessions(appRef.current.sessions.filter(item=>item.id!==temporaryId),session);if(revision.current===dr)setDraft(captured);}
        else if(!hasText){current={...current,messages:current.messages.filter(item=>item.id!==assistantId)};publish();}
        if(!controller.signal.aborted)setError(errorKey(e));
      }
    }finally{if(streamController.current===controller)streamController.current=null;inFlight.current=false;if(valid())setPending(false);}
  }
  async function removeChat(){
    const id=confirmChat,user=appRef.current.user;
    if(!id||!user||deletingChat)return;
    setDeletingChat(true);setDeleteError('');
    try{
      await api.deleteChat(user,id);
      if(appRef.current.user?.uid!==user.uid)return;
      if(appRef.current.activeSession===id){streamController.current?.abort();sessionRevision.current++;revision.current++;setDraft('');setError('');}
      appRef.current.updateSessions(appRef.current.sessions.filter(s=>s.id!==id),appRef.current.activeSession===id?null:appRef.current.activeSession);
      setConfirmChat(null);
    }catch(e){setDeleteError(errorKey(e));}finally{setDeletingChat(false);}
  }
  const prompts=[['promptBudget','promptBudgetHint',Wallet],['promptCity','promptCityHint',MapPin],['promptTranscript','promptTranscriptHint',FileText],['promptRibs','promptRibsHint',Utensils]] as const;
  const renderAnswer=(m:NonNullable<typeof active>['messages'][number])=>m.demo?t(m.demo.key,{count:m.demo.count||0,amount:m.demo.amount||'',text:m.demo.text||'',notes:m.demo.notes||''}):m.content;
  return <div className={`page chat-page ${memory?'memory-open':''}`}><div className="chat-top"><div className="chat-title-group"><span className="chat-title-icon"><Brain size={20}/></span><div><h1>{t('chatTitle')}</h1><p>{t('chatSubtitle')} · <span>{t('savedCount',{count:saved.length})}</span></p></div></div><Link className="chat-home" to="/profile">⌂ {t(app.profile?.user_address?'homeSaved':'setHome')}<small>{t(isMock?'localDemo':'connectedService')}</small></Link></div><div className="history-actions"><button className="text-button history-toggle" aria-expanded={history} onClick={()=>setHistory(!history)}><History size={14}/>{t('recentSessions')}</button><div><Button className="small" onClick={newChat}><Plus size={14}/>{t('newChat')}</Button><Button className="small" variant="secondary" onClick={event=>{memoryTrigger.current=event.currentTarget;setMemory(true);}}><Brain size={14}/>{t('memory')}</Button></div></div><div className="chat-workspace">{!memory&&<aside className={`chat-history ${history?'open':''}`}><h3>{t('recentSessions')}</h3>{!app.sessions.length&&<p>{t('noSessions')}</p>}<div className="session-list">{[...app.sessions].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map(s=><div key={s.id} className={`session-row ${s.id===app.activeSession?'active':''}`}><button type="button" className="session-open" title={s.title} onClick={()=>{streamController.current?.abort();sessionRevision.current++;revision.current++;app.setActiveSession(s.id);setDraft('');setError('');setHistory(false);}}><span className="session-title">{s.title}</span></button>{!isMock&&!s.id.startsWith('pending-')&&<button type="button" className="session-delete" aria-label={t('deleteChatLabel',{title:s.title})} title={t('deleteChatLabel',{title:s.title})} onClick={()=>{setDeleteError('');setConfirmChat(s.id);}}><Trash2 size={15}/></button>}</div>)}</div></aside>}<section className="chat-conversation">{!active?.messages.length?<><div className="chat-welcome"><div className="chat-orb"><Sparkles size={30}/></div><h2>{t('chatWelcomeStart')}<br/><em>{t('chatWelcomeEnd')}</em></h2><p>{t('chatWelcomeHint')}</p><span className="grounded"><Bookmark size={12}/>{t('groundedCount',{count:saved.length})}</span></div><h3 className="prompt-heading">{t('suggestedQuestions')}</h3><div className="prompts">{prompts.map(([key,hint,Icon])=><button className="prompt" key={key} disabled={pending} onClick={()=>void send(t(key))}><Icon size={20}/><span>{t(key)}<small>{t(hint)}</small></span></button>)}</div><div className="ai-notice"><strong>{t('aiNoticeTitle')}</strong><br/>{t(isMock?'aiNotice':'aiNoticeLive')}</div></>:<div className="messages">{active.messages.map(m=><article className={`message chat-message ${m.role}`} key={m.id}><div className="message-label">{m.role==='user'?t('you'):'WeEat AI'}</div><div className="message-text">{m.role==='assistant'&&!isMock?<ChatText text={m.content}/>:m.role==='assistant'?renderAnswer(m):m.content}{m.role==='assistant'&&m.demo?.notes&&['aiMatches','aiBudgetMatches'].includes(m.demo.key)&&<p>{t('memoryContext',{notes:m.demo.notes})}</p>}</div>{m.references&&m.references.length>0&&<div className="recommendations">{m.references.map(ref=>saved.find(r=>r.video_id===ref.video_id&&r.restaurant_id===ref.restaurant_id)).filter(r=>!!r).map(r=><RestaurantCard key={identity(r)} entry={r} variant="recommendation"/>)}</div>}</article>)}</div>}{pending&&<div className="processing ask-progress" role="status"><span className="spinner"/> <span>{t(isMock?'loadingData':phase==='answering'?'askAnswering':'askSearching')}</span>{!isMock&&<button type="button" className="button secondary small" onClick={()=>streamController.current?.abort()}>{t('stopAnswer')}</button>}</div>}{error&&<ErrorNotice message={error}/>}</section>{memory&&<MemoryManager uid={app.user!.uid} onClose={closeMemory}/>}</div><div className="composer"><div className="composer-shortcuts"><button disabled={pending} onClick={()=>void send(t('findNoodles'))}><Utensils size={11}/>{t('noodlePlaces')}</button><button disabled={pending} onClick={()=>void send(t('dinnerIdeas'))}><Utensils size={11}/>{t('dinnerIdeas')}</button><button disabled={pending} onClick={()=>void send(t('promptBudget'))}><Wallet size={11}/>{t('budgetUnder')}</button></div><form onSubmit={e=>{e.preventDefault();void send();}}><input aria-label={t('messageLabel')} placeholder={t('messagePlaceholder')} maxLength={1000} value={draft} onChange={e=>{revision.current++;setDraft(e.target.value);}}/><Button aria-label={t('sendMessage')} disabled={pending||!draft.trim()}><Send size={17}/></Button></form><small>{t(isMock?'chatFootnote':'chatFootnoteLive')}</small></div>{confirmChat&&<div className="chat-delete-backdrop" onClick={()=>{if(!deletingChat)setConfirmChat(null);}}><div className="chat-delete-dialog" role="alertdialog" aria-modal="true" aria-label={t('deleteChat')} onClick={event=>event.stopPropagation()}><h2>{t('deleteChat')}</h2><p>{t('deleteChatConfirm')}</p>{deleteError&&<ErrorNotice message={deleteError}/>}<div className="dialog-actions"><Button variant="secondary" disabled={deletingChat} onClick={()=>setConfirmChat(null)}>{t('cancel')}</Button><Button variant="danger" disabled={deletingChat} onClick={()=>void removeChat()}>{t('confirmDeleteChat')}</Button></div></div></div>}</div>;
}
