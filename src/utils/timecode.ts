export function formatHms(seconds:number):string {
  const total=Math.max(0,Math.round(Number.isFinite(seconds)?seconds:0));
  return [Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(part=>String(part).padStart(2,'0')).join(':');
}
