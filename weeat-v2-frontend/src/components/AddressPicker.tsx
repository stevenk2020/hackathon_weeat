import { useEffect,useId,useRef,useState } from 'react';
import { MapPin,LocateFixed,Check,X } from 'lucide-react';
import type { Address } from '../types';
import { useI18n } from '../i18n';
import { searchAddresses,resolveAddress,currentLocation,type AddressOption } from '../services/locationService';
import { readMapOrigin } from '../services/mapOrigin';
import { fold,validAddress } from '../services/domain';
import { isMock } from '../services/config';
import { useApp } from '../services/AppContext';
import { errorKey } from '../services/errors';
import { ErrorNotice } from './ui';

export function AddressPicker({value,selected,onChange,label,ariaLabel,variant='profile',gps=true,clear=false}:{value:string;selected:Address|null;onChange:(text:string,address:Address|null)=>void;label:string;ariaLabel?:string;variant?:'profile'|'map';gps?:boolean;clear?:boolean}) {
  const {t}=useI18n(),app=useApp(),id=useId();
  const [items,setItems]=useState<AddressOption[]>([]),[open,setOpen]=useState(false),[pending,setPending]=useState(false),
    [locating,setLocating]=useState(false),[error,setError]=useState(''),[index,setIndex]=useState(-1),[more,setMore]=useState(false);
  const generation=useRef(0),session=useRef(crypto.randomUUID());
  const input=useRef<HTMLInputElement>(null);
  const minLength=/[0-9]/.test(value)?3:4;
  const ready=value.trim().length>=minLength;
  const ownAddresses=():Address[]=>{
    if(isMock)return [];
    const known:Address[]=[];
    if(app.user){const recent=readMapOrigin(app.user.uid);if(recent)known.push(recent);}
    const profile=app.profile;
    if(profile?.user_address&&profile.user_lat!==null&&profile.user_long!==null)
      known.push({id:'home',label:profile.user_address,latitude:profile.user_lat,longitude:profile.user_long,provider:'api',source:'goong'});
    for(const place of app.restaurants){if(place.is_saved!==1||place.latitude===null||place.longitude===null||!place.address)continue;
      known.push({id:`saved:${place.video_id}:${place.restaurant_id}`,label:place.address,latitude:place.latitude,
        longitude:place.longitude,provider:'api',source:place.geo_source?.startsWith('vietmap')?'vietmap':'goong'});}
    return [...new Map(known.map(address=>[fold(address.label),address])).values()];
  };
  useEffect(()=>{
    const request=++generation.current;
    setItems([]);setIndex(-1);
    if(!ready||selected){setPending(false);return;}
    setPending(true);
    const timer=setTimeout(()=>{
      const local=ownAddresses().filter(address=>fold(address.label).includes(fold(value.trim())));
      if(!isMock&&!more){if(request===generation.current){setItems(local);setPending(false);}return;}
      void searchAddresses(value,session.current).then(rows=>{
        if(request!==generation.current)return;
        setItems([...new Map([...local,...rows].map(row=>[fold(row.label),row])).values()]);
      }).catch(cause=>{if(request===generation.current)setError(errorKey(cause));})
        .finally(()=>{if(request===generation.current)setPending(false);});
    },more?0:600);
    return()=>{clearTimeout(timer);generation.current++;};
  },[value,selected,more,app.user?.uid,app.profile?.user_address,app.restaurants.length]);
  const choose=async(option:AddressOption)=>{
    const request=++generation.current;
    setPending(true);setError('');
    try {
      const address='ref' in option?await resolveAddress(option.ref,session.current):option;
      if(request!==generation.current)return;
      onChange(address.label,address);
      setOpen(false);setMore(false);setIndex(-1);session.current=crypto.randomUUID();
    }catch(cause){if(request===generation.current)setError(errorKey(cause));}
    finally{if(request===generation.current)setPending(false);}
  };
  const locate=async()=>{
    const request=++generation.current;
    setLocating(true);setError('');
    try{const address=await currentLocation();if(request===generation.current)await choose(address);}
    catch(cause){if(request===generation.current)setError(errorKey(cause));}
    finally{setLocating(false);}
  };
  const gpsButton=<button type="button" className="icon-button" disabled={locating} aria-label={t('getCurrentLocation')} onClick={()=>void locate()}><LocateFixed size={16}/></button>;
  return <div className={`address-picker ${variant}`}><div className="address-row"><span className={variant==='map'?'endpoint-dot':''}>{variant==='profile'&&<MapPin size={18}/>}</span><div><label htmlFor={id}>{label}</label><input ref={input} id={id} role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={open&&!selected&&ready} aria-controls={`${id}-list`} aria-activedescendant={open&&index>=0&&items[index]?`${id}-${index}`:undefined} maxLength={240} autoComplete="off" placeholder={t(variant==='profile'?'addressPlaceholder':'fromPlaceholder')} value={value} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onChange={event=>{generation.current++;setError('');setOpen(true);setMore(false);onChange(event.target.value,null);}} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);return;}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setIndex(current=>Math.max(0,Math.min(items.length-1,current+(event.key==='ArrowDown'?1:-1))));}if(event.key==='Enter'&&open&&index>=0&&items[index]){event.preventDefault();void choose(items[index]);}}}/></div>{variant==='map'&&gps?gpsButton:clear&&value?<button type="button" className="icon-button" aria-label={t('clearDestination')} onClick={()=>{generation.current++;onChange('',null);setMore(false);session.current=crypto.randomUUID();}}><X size={15}/></button>:selected&&validAddress(selected)?<Check size={16}/>:<span/>}</div>
  {open&&!selected&&ready&&<div className="suggestions" id={`${id}-list`} role="listbox" aria-label={t('addressSuggestions')}>{pending?<p role="status">{t('addressSearching')}</p>:items.length?items.map((option,i)=><div id={`${id}-${i}`} role="option" aria-selected={i===index} className={i===index?'highlight':''} key={option.id} onMouseDown={event=>event.preventDefault()} onClick={()=>void choose(option)}>{option.label}</div>):<p>{t('addressNoResults')}</p>}{!isMock&&!more&&<button type="button" className="text-button address-search-more" onMouseDown={event=>event.preventDefault()} onClick={()=>setMore(true)}>{t('addressSearchMore')}</button>}</div>}
  {variant==='profile'&&gps&&<button type="button" className="text-button gps-text" disabled={locating} onClick={()=>void locate()}><LocateFixed size={14}/>{t(locating?'locatingAddress':'useCurrentLocation')}</button>}{locating&&variant==='map'&&<small role="status">{t('locatingAddress')}</small>}{error&&<ErrorNotice message={error}/>}</div>;
}
