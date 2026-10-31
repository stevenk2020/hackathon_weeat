import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthUser,Category,Profile,Restaurant,SourceVideo,ChatSession,Analysis,Edits } from '../types';
import { api } from './api';
import { initialUser,demoUser,getAuthAdapter } from './auth';
import { isMock } from './config';
import { identity } from './domain';
import { ServiceError,errorKey } from './errors';
interface DiscoverState {draft:string;resultKeys:string[];source:SourceVideo|null;originalUrl:string;scroll:number}
interface State {user:AuthUser|null;profile:Profile|null;restaurants:Restaurant[];videos:SourceVideo[];categories:Category[];sessions:ChatSession[];activeSession:string|null;loading:boolean;error:string;storageWarning:boolean;toast:string;authOpen:boolean;pending:Set<string>;discover:DiscoverState}
interface Actions {setDiscover:(value:Partial<DiscoverState>)=>void;signIn:()=>Promise<void>;signOut:()=>Promise<void>;setAuthOpen:(v:boolean)=>void;loginUser:(u:AuthUser)=>void;notify:(key:string)=>void;reload:()=>void;analyze:(url:string)=>Promise<Analysis>;save:(r:Restaurant,saved?:boolean)=>Promise<void>;edit:(r:Restaurant,e:Edits)=>Promise<void>;updateProfile:(p:Partial<Profile>)=>Promise<void>;updateSessions:(sessions:ChatSession[],active:string|null)=>void;setActiveSession:(id:string|null)=>void;mergeLibrary:(rows:Restaurant[])=>void}
const blankDiscover=():DiscoverState=>({draft:'',resultKeys:[],source:null,originalUrl:'',scroll:0});
const Context=createContext<(State&Actions)|null>(null);
export function AppProvider({children}:{children:ReactNode}) {
  const navigate=useNavigate();const [user,setUser]=useState(initialUser);const currentUser=useRef(user);currentUser.current=user;
  const [profile,setProfile]=useState<Profile|null>(null),[restaurants,setRestaurants]=useState<Restaurant[]>([]),[videos,setVideos]=useState<SourceVideo[]>([]),[categories,setCategories]=useState<Category[]>([]),[sessions,setSessions]=useState<ChatSession[]>([]),[activeSession,setActiveSession]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[storageWarning,setStorageWarning]=useState(false),[toast,setToast]=useState(''),[authOpen,setAuthOpen]=useState(false),[pending,setPending]=useState(new Set<string>()),[discover,setDiscoverState]=useState(blankDiscover),[revision,setRevision]=useState(0);
  const locks=useRef(new Set<string>());
  useEffect(()=>{let disposed=false;api.categories().then(c=>{if(!disposed)setCategories(c);}).catch(e=>{if(!disposed)setError(errorKey(e));});return()=>{disposed=true;};},[revision]);
  useEffect(()=>{const listener=()=>setStorageWarning(true);window.addEventListener('weeat-storage-error',listener);return()=>window.removeEventListener('weeat-storage-error',listener);},[]);
  useEffect(()=>{let unsubscribe:(()=>void)|undefined;const connect=()=>{unsubscribe?.();const adapter=getAuthAdapter();if(adapter){setUser(adapter.currentUser());unsubscribe=adapter.subscribe(setUser);}};connect();window.addEventListener('weeat-auth-adapter',connect);return()=>{unsubscribe?.();window.removeEventListener('weeat-auth-adapter',connect);};},[]);
  useEffect(()=>{let disposed=false;setProfile(null);setRestaurants([]);setVideos([]);setSessions([]);setActiveSession(null);setDiscoverState(s=>({...blankDiscover(),draft:user?s.draft:''}));setError('');locks.current.clear();setPending(new Set());
    if(!user){setLoading(false);return;}setLoading(true);
    void (async()=>{try{const [p,rows]=await Promise.all([api.profile(user),api.library(user)]);let cached:Awaited<ReturnType<typeof import('./mockServer')['snapshot']>>|null=null;if(import.meta.env.DEV && isMock){const {snapshot}=await import('./mockServer');cached=snapshot(user.uid,user.email);}if(disposed)return;setProfile(p);setRestaurants(cached?.restaurants.map(r=>({...r}))||rows);setVideos(cached?.videos||[]);setSessions(cached?.sessions||[]);setActiveSession(cached?.activeSession||null);}catch(e){if(!disposed)setError(errorKey(e));}finally{if(!disposed)setLoading(false);}})();return()=>{disposed=true;};
  },[user?.uid,revision]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(id);},[toast]);
  const loginUser=(u:AuthUser)=>{currentUser.current=u;setUser(u);setAuthOpen(false);try{sessionStorage.setItem('weeat-v2-session-v1',JSON.stringify({uid:u.uid,email:u.email}));}catch{setStorageWarning(true);}};
  const readyUser=()=>{const u=currentUser.current;if(!u){setAuthOpen(true);throw new ServiceError('analysisSignInRequired');}if(!profile?.user_address||profile.user_lat===null||profile.user_long===null){navigate('/profile');throw new ServiceError('onboardingHint');}return u;};
  async function run<T>(key:string,work:(u:AuthUser)=>Promise<T>,commit:(v:T)=>void,requireReady=true){const u=requireReady?readyUser():currentUser.current;if(!u)throw new ServiceError('AUTH');const lock=`${u.uid}:${key}`;if(locks.current.has(lock))throw new ServiceError('loadingData');locks.current.add(lock);setPending(s=>new Set(s).add(key));try{const value=await work(u);if(currentUser.current?.uid!==u.uid)throw new ServiceError('AUTH');commit(value);return value;}finally{locks.current.delete(lock);if(currentUser.current?.uid===u.uid)setPending(s=>{const next=new Set(s);next.delete(key);return next;});}}
  const merge=(rows:Restaurant[])=>setRestaurants(old=>[...new Map([...old,...rows].map(r=>[identity(r),r])).values()]);
  const actions:Actions={setDiscover:value=>setDiscoverState(s=>({...s,...value})),setAuthOpen,loginUser,notify:setToast,reload:()=>setRevision(r=>r+1),
    signIn:async()=>{if(import.meta.env.DEV && isMock){loginUser(demoUser());navigate('/profile');return;}const adapter=getAuthAdapter();if(!adapter)throw new ServiceError('authBlocked');await adapter.signIn();setAuthOpen(false);},
    signOut:async()=>{if(!import.meta.env.DEV || !isMock)await getAuthAdapter()?.signOut();currentUser.current=null;setUser(null);try{sessionStorage.removeItem('weeat-v2-session-v1');}catch{setStorageWarning(true);}navigate('/');setToast('toastSignedOut');},
    analyze:url=>run('analyze',u=>api.analyze(u,url),value=>{setVideos(old=>[...old.filter(v=>v.video_id!==value.video.video_id),value.video]);setRestaurants(old=>{const next=value.restaurants.map(r=>{const existing=old.find(x=>identity(x)===identity(r));return existing?.is_saved?{...r,is_saved:1 as const}:r;});return [...old.filter(x=>!next.some(r=>identity(r)===identity(x))),...next];});setDiscoverState(s=>({...s,resultKeys:value.restaurants.map(identity),source:value.video,originalUrl:url,scroll:0}));}),
    save:async(r,saved=true)=>{await run(`save:${identity(r)}`,u=>api.save(u,r,saved),value=>{merge([{...r,is_saved:value}]);setToast(saved?'toastSaved':'toastRemoved');});},
    edit:async(r,e)=>{await run(`edit:${identity(r)}`,u=>api.edit(u,r,e),value=>{merge([value]);setToast('toastEdited');});},
    updateProfile:async patch=>{await run('profile',u=>api.updateProfile(u,patch),value=>{setProfile(value);setToast('toastProfile');navigate('/');},false);},
    updateSessions:(next,active)=>{setSessions(next);setActiveSession(active);if(import.meta.env.DEV&&isMock&&user)void import('./mockServer').then(m=>m.persistChats(user.uid,next,active));},setActiveSession,mergeLibrary:merge,
  };
  return <Context.Provider value={{user,profile,restaurants,videos,categories,sessions,activeSession,loading,error,storageWarning,toast,authOpen,pending,discover,...actions}}>{children}</Context.Provider>;
}
export function useApp(){const value=useContext(Context);if(!value)throw Error('AppProvider missing');return value;}
