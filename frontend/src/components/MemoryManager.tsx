import { useEffect,useState } from 'react';
import { Trash2,X } from 'lucide-react';
import { useI18n } from '../i18n';
import { readMemories,deleteMemory,type Memory } from '../services/memoryStore';
import { errorKey } from '../services/errors';
import { Button,ErrorNotice,Modal } from './ui';
export function MemoryManager({uid,onClose}:{uid:string;onClose:()=>void}){const {t}=useI18n(),[notes,setNotes]=useState<Memory[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[confirm,setConfirm]=useState<string|null>(null),[deleting,setDeleting]=useState(false),[mobile,setMobile]=useState(()=>matchMedia('(max-width:600px)').matches);
  const refresh=()=>{setLoading(true);setError('');try{setNotes(readMemories(uid));}catch(e){setError(errorKey(e));}finally{setLoading(false);}};
  useEffect(()=>{refresh();window.addEventListener('weeat-memory',refresh);window.addEventListener('storage',refresh);return()=>{window.removeEventListener('weeat-memory',refresh);window.removeEventListener('storage',refresh);};},[uid]);
  useEffect(()=>{const m=matchMedia('(max-width:600px)'),change=()=>setMobile(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
  const content=<aside className="memory-panel" aria-label={t('memoryTitle')}><div className="heading-row"><h2>{t('memoryTitle')}</h2>{!mobile&&<button className="icon-button" aria-label={t('closeMemory')} onClick={onClose}><X size={18}/></button>}</div>{loading&&<p role="status">{t('loadingData')}</p>}{error&&<ErrorNotice message={error} retry={refresh}/>} {!loading&&!error&&!notes.length&&<p className="empty-copy">{t('noMemories')}</p>}{notes.map(n=><div key={n.id}><div className="memory-note"><p>{n.text}</p><button className="icon-button" aria-label={t('deleteMemoryNote',{text:n.text})} onClick={()=>setConfirm(n.id)}><Trash2 size={16}/></button></div>{confirm===n.id&&<div className="memory-confirm"><p>{t('deleteMemoryConfirm')}</p><div className="dialog-actions"><Button variant="secondary" onClick={()=>setConfirm(null)}>{t('cancel')}</Button><Button variant="danger" disabled={deleting} onClick={()=>{setDeleting(true);setError('');try{deleteMemory(uid,n.id);setConfirm(null);refresh();}catch(e){setError(errorKey(e));}finally{setDeleting(false);}}}>{t(deleting?'deletingMemory':'confirmDeleteMemory')}</Button></div></div>}</div>)}</aside>;
  return mobile?<Modal title={t('memoryTitle')} onClose={onClose}><div className="memory-mobile">{content}</div></Modal>:content;
}
