import { useState,type FormEvent } from 'react';
import type { Address,Edits,Restaurant } from '../types';
import { useI18n } from '../i18n';
import { useApp } from '../services/AppContext';
import { errorKey,ServiceError } from '../services/errors';
import { validAddress } from '../services/domain';
import { isMock } from '../services/config';
import { AddressPicker } from './AddressPicker';
import { Button,Modal,ErrorNotice } from './ui';
export function RestaurantEditor({entry,onClose}:{entry:Restaurant;onClose:()=>void}) {
  const {t}=useI18n(),app=useApp();
  const [draft,setDraft]=useState({...entry});
  const [selected,setSelected]=useState<Address|null>(()=>entry.latitude!==null&&entry.longitude!==null&&entry.address?
    {id:'existing',label:entry.address,latitude:entry.latitude,longitude:entry.longitude,provider:isMock?'mock':'api',
      source:entry.geo_source?.startsWith('vietmap')?'vietmap':'goong'}:null);
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(pending)return;setError('');
    try {
      if(!draft.restaurant_name.trim()||!draft.dish.trim()||!draft.address.trim())throw new ServiceError('editRequired');
      if((draft.price_vnd!==null&&draft.price_vnd<0)||(draft.price_vnd_max!==null&&draft.price_vnd_max<0))throw new ServiceError('priceNonnegative');
      if(draft.price_vnd!==null&&draft.price_vnd_max!==null&&draft.price_vnd_max<draft.price_vnd)throw new ServiceError('priceValidation');
      const edits:Edits={};
      for(const field of ['restaurant_name','dish','address'] as const){const value=draft[field].trim();if(value!==entry[field])edits[field]=value;}
      for(const field of ['price_vnd','price_vnd_max'] as const)if(draft[field]!==entry[field])edits[field]=draft[field];
      if(entry.is_saved===1&&draft.user_note!==entry.user_note)edits.user_note=draft.user_note;
      if(edits.address&&!isMock){
        if(!validAddress(selected)||selected.label!==edits.address||!selected.source)throw new ServiceError('addressChoose');
        edits.latitude=selected.latitude;edits.longitude=selected.longitude;edits.geo_source=selected.source;
      }
      if(!Object.keys(edits).length){onClose();return;}
      setPending(true);await app.edit(entry,edits);onClose();
    }catch(cause){setError(errorKey(cause));}finally{setPending(false);}
  };
  return <Modal title={t('editSpot')} description={t('editDescription')} onClose={onClose}><form onSubmit={submit}>
    {(['restaurant_name','dish'] as const).map((field,i)=><label className="field" key={field}>{t(i?'signatureDish':'restaurantName')}<input required maxLength={i?200:120} value={draft[field]} onChange={event=>setDraft({...draft,[field]:event.target.value})}/></label>)}
    {isMock?<label className="field">{t('locationLabel')}<input required maxLength={240} value={draft.address} onChange={event=>setDraft({...draft,address:event.target.value})}/></label>:
      <div className="field"><span>{t('locationLabel')}</span><AddressPicker value={draft.address} selected={selected} label={t('locationLabel')} gps={false}
        onChange={(text,address)=>{setDraft(current=>({...current,address:text}));setSelected(address);}}/></div>}
    <div className="two-columns">{(['price_vnd','price_vnd_max'] as const).map((field,i)=><label className="field" key={field}>{t(i?'maxPrice':'minPrice')}<input type="number" min="0" value={draft[field]??''} onChange={event=>setDraft({...draft,[field]:event.target.value===''?null:Number(event.target.value)})}/></label>)}</div>
    {entry.is_saved===1&&<label className="field">{t('personalNotes')}<textarea maxLength={500} value={draft.user_note} placeholder={t('notesPlaceholder')} onChange={event=>setDraft({...draft,user_note:event.target.value})}/></label>}
    {error&&<ErrorNotice message={error}/>}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={pending}>{t('saveChanges')}</Button></div>
  </form></Modal>;
}
export function DeleteRestaurant({entry,onClose}:{entry:Restaurant;onClose:()=>void}){const app=useApp(),{t}=useI18n();const [pending,setPending]=useState(false),[error,setError]=useState('');return <Modal title={t('removeTitle')} onClose={onClose}><p>{t('removeStart')} <strong>{entry.restaurant_name}</strong> {t('removeEnd')}</p>{error&&<ErrorNotice message={error}/>}<div className="dialog-actions"><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button variant="danger" disabled={pending} onClick={async()=>{setPending(true);try{await app.save(entry,false);onClose();}catch(e){setError(errorKey(e));}finally{setPending(false);}}}>{t('confirmRemove')}</Button></div></Modal>;}
