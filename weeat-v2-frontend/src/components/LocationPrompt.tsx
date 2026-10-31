import { useState } from 'react';
import { Home,LocateFixed,MapPin } from 'lucide-react';
import type { Address,Profile } from '../types';
import type { AskLocation } from '../services/askStream';
import { currentLocation } from '../services/locationService';
import { errorKey } from '../services/errors';
import { useI18n } from '../i18n';
import { AddressPicker } from './AddressPicker';
import { Button,ErrorNotice } from './ui';

export function LocationPrompt({profile,onChoose,disabled=false}:{profile:Profile|null;onChoose:(location:AskLocation,address?:Address)=>void;disabled?:boolean}){
  const {t}=useI18n();
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const choose=(location:AskLocation,address?:Address)=>{if(!busy&&!disabled)onChoose(location,address);};
  const home=profile?.user_address&&profile.user_lat!==null&&profile.user_long!==null
    ? {id:'home',label:profile.user_address,latitude:profile.user_lat,longitude:profile.user_long,provider:'api' as const}:null;
  const useCurrent=async()=>{if(busy||disabled)return;setBusy(true);setError('');try{const address=await currentLocation();onChoose({label:address.label,latitude:address.latitude,longitude:address.longitude,source:'current'},address);}catch(e){setError(errorKey(e));}finally{setBusy(false);}};
  return <div className="location-prompt"><h3>{t('locationPromptTitle')}</h3><div className="location-prompt-options"><Button type="button" variant="secondary" disabled={busy||disabled} onClick={()=>void useCurrent()}><LocateFixed size={15}/>{t('useCurrentLocation')}</Button>{home&&<Button type="button" variant="secondary" disabled={busy||disabled} onClick={()=>choose({label:home.label,latitude:home.latitude,longitude:home.longitude,source:'home'},home)}><Home size={15}/>{t('locationUseHome',{address:home.label})}</Button>}</div><p className="location-type-label">{t('locationTypeLabel')}</p><AddressPicker value={text} selected={null} onChange={(value,address)=>{setText(value);if(address)choose({label:address.label,latitude:address.latitude,longitude:address.longitude,source:'autocomplete'},address);}} label={t('locationTypeLabel')} ariaLabel={t('locationTypeLabel')} placeholder={t('locationTypePlaceholder')} gps={false} autoSearch/>{text.trim().length>=2&&<Button type="button" className="location-use-typed" disabled={busy||disabled} onClick={()=>choose({label:text.trim(),source:'typed'})}><MapPin size={15}/>{t('locationUseTyped',{text:text.trim()})}</Button>}{error&&<ErrorNotice message={error}/>}</div>;
}
