import {useEffect,useState} from 'react';
import {useLanguage} from '../locales';
import {disableZenCookies,enableZenCookies,getZenCookieProfile} from '../utils/cookieUtils';
import {getErrorMessage} from '../utils/errors';
import styles from './CookiesModal.module.css';

interface Profile {id:string;name:string;default:boolean}
export function ZenCookiesImport({onImported}:{onImported:()=>void}) {
  const {t}=useLanguage();
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [profile,setProfile]=useState(getZenCookieProfile);
  const [active,setActive]=useState(getZenCookieProfile);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/cookies/zen/profiles',{signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.detail || 'Could not list Zen profiles.');
      if(controller.signal.aborted)return;
      const items:Profile[]=data.profiles;
      setProfiles(items);setProfile(current=>items.some(item=>item.id===current)?current:items[0]?.id || '');setError('');
    }).catch(error=>{if(!controller.signal.aborted)setError(getErrorMessage(error));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[revision]);
  useEffect(()=>{
    const refresh=()=>setActive(getZenCookieProfile());
    window.addEventListener('cheatclip_cookies_updated',refresh);
    window.addEventListener('storage',refresh);
    return ()=>{window.removeEventListener('cheatclip_cookies_updated',refresh);window.removeEventListener('storage',refresh);};
  },[]);
  const connect=async()=>{
    setBusy(true);setError('');setMessage('');
    try {await enableZenCookies(profile);setActive(profile);onImported();setMessage(t.cookies.autoZenConnected);}
    catch(error){setError(getErrorMessage(error));}
    finally {setBusy(false);}
  };
  return <section className={styles.autoZen} aria-label={t.cookies.autoZenTitle}>
    <h3>{t.cookies.autoZenTitle}</h3><p>{t.cookies.autoZenDescription}</p>
    <label htmlFor="zen-cookie-profile">{t.cookies.autoZenProfile}</label>
    <select id="zen-cookie-profile" value={profile} disabled={busy || loading || !profiles.length} onChange={e=>setProfile(e.target.value)}>
      {!profiles.length && <option value="">{loading?t.cookies.autoZenLoading:t.cookies.autoZenNoProfiles}</option>}
      {profiles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <div className={styles.uploadRow}>
      <button type="button" className={styles.btnSave} disabled={busy || loading || !profile} onClick={()=>void connect()}>{busy?t.cookies.autoZenLoading:active?t.cookies.autoZenRefresh:t.cookies.autoZenConnect}</button>
      <button type="button" className={styles.btnCancel} disabled={busy || loading} onClick={()=>{setLoading(true);setRevision(v=>v+1);}}>{t.cookies.autoZenReload}</button>
    </div>
    {active && <div><p>{t.cookies.autoZenEnabled}</p><button type="button" className={styles.btnCancel} disabled={busy} onClick={()=>{disableZenCookies();setActive('');setMessage('');}}>{t.cookies.autoZenDisable}</button></div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.autoZenError}>{error}</p>}
  </section>;
}
