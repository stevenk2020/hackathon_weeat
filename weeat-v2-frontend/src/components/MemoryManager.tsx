import { useEffect,useRef,useState } from 'react';
import { Trash2,X } from 'lucide-react';
import { useI18n } from '../i18n';
import { readMemories,deleteMemory as deleteMockMemory } from '../services/memoryStore';
import { api } from '../services/api';
import { useApp } from '../services/AppContext';
import { isMock } from '../services/config';
import { errorKey } from '../services/errors';
import { Button,ErrorNotice,Modal } from './ui';

interface MemoryNote {id:string;text:string}

export function MemoryManager({uid,onClose}:{uid:string;onClose:()=>void}){
  const {t}=useI18n(),user=useApp().user,[notes,setNotes]=useState<MemoryNote[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[confirm,setConfirm]=useState<string|null>(null),[deleting,setDeleting]=useState(false),[mobile,setMobile]=useState(()=>matchMedia('(max-width:600px)').matches);
  const loadVersion=useRef(0);
  const refresh=()=>{
    const version=++loadVersion.current;
    setLoading(true);setError('');
    if(isMock){try{setNotes(readMemories(uid));}catch(e){setError(errorKey(e));}finally{setLoading(false);}return;}
    if(!user||user.uid!==uid){setLoading(false);return;}
    void api.memory(user).then(rows=>{if(loadVersion.current===version)setNotes(rows);}).catch(e=>{if(loadVersion.current===version)setError(errorKey(e));}).finally(()=>{if(loadVersion.current===version)setLoading(false);});
  };
  useEffect(()=>{refresh();if(isMock){window.addEventListener('weeat-memory',refresh);window.addEventListener('storage',refresh);}return()=>{loadVersion.current++;if(isMock){window.removeEventListener('weeat-memory',refresh);window.removeEventListener('storage',refresh);}};},[uid,user?.uid]);
  useEffect(()=>{const m=matchMedia('(max-width:600px)'),change=()=>setMobile(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
  const remove=async(id:string)=>{
    if(deleting)return;
    setDeleting(true);setError('');
    try{
      if(isMock){deleteMockMemory(uid,id);setConfirm(null);refresh();}
      else if(user&&user.uid===uid){await api.deleteMemory(user,id);setNotes(old=>old.filter(n=>n.id!==id));setConfirm(null);}
    }catch(e){setError(errorKey(e));}finally{setDeleting(false);}
  };
  const content=<aside className="memory-panel" role={mobile?undefined:'dialog'} aria-label={t('memoryTitle')}><div className="heading-row"><h2>{t('memoryTitle')}</h2>{!mobile&&<button className="icon-button" aria-label={t('closeMemory')} onClick={onClose}><X size={18}/></button>}</div>{loading&&<p role="status">{t('loadingData')}</p>}{error&&<ErrorNotice message={error} retry={refresh}/>} {!loading&&!error&&!notes.length&&<p className="empty-copy">{t('noMemories')}</p>}<ul className="memory-list">{notes.map(n=><li key={n.id}><div className="memory-note"><p>{n.text}</p><button className="icon-button" aria-label={t('deleteMemoryNote',{text:n.text})} onClick={()=>setConfirm(n.id)}><Trash2 size={16}/></button></div>{confirm===n.id&&<div className="memory-confirm"><p>{t('deleteMemoryConfirm')}</p><div className="dialog-actions"><Button variant="secondary" onClick={()=>setConfirm(null)}>{t('cancel')}</Button><Button variant="danger" disabled={deleting} onClick={()=>void remove(n.id)}>{t(deleting?'deletingMemory':'confirmDeleteMemory')}</Button></div></div>}</li>)}</ul></aside>;
  return mobile?<Modal className="memory-drawer" title={t('memoryTitle')} closeLabel={t('closeMemory')} onClose={onClose}><div className="memory-mobile">{content}</div></Modal>:content;
}
