import { useState } from 'react';
import { useI18n } from '../i18n';

export function InstallBanner(){
  const {t}=useI18n();
  const [visible,setVisible]=useState(()=>{
    if(typeof navigator==='undefined')return false;
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone;
    try{return ios&&!standalone&&sessionStorage.getItem('weeat-install-dismissed')!=='1';}catch{return ios&&!standalone;}
  });
  if(!visible)return null;
  return <aside className="install-banner" role="note"><strong>{t('installTitle')}</strong><p>{t('installBody')}</p><button className="button secondary small" onClick={()=>{setVisible(false);try{sessionStorage.setItem('weeat-install-dismissed','1');}catch{/* dismissal lasts until reload */}}}>{t('installDismiss')}</button></aside>;
}
