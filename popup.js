const $=id=>document.getElementById(id);
let course=null,comparison=null,sourceRoot=null,destinationRoot=null,activeFilter='all',quarantineCache=new Map();
const DB_NAME='SpotCleanerDB',STORE='quarantine';
function notify(t){$('notice').textContent=t;$('notice').classList.add('show')}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function dbAll(){const db=await openDB();return new Promise((res,rej)=>{const q=db.transaction(STORE).objectStore(STORE).getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbAdd(v){const db=await openDB();return new Promise((res,rej)=>{const q=db.transaction(STORE,'readwrite').objectStore(STORE).add(v);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function dbDelete(id){const db=await openDB();return new Promise((res,rej)=>{const q=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}
async function extract(){
  $('pageState').textContent='در حال بررسی';
  $('extractBtn').disabled=true;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!tab.url?.startsWith('https://app.spotplayer.ir/')) throw Error('ابتدا صفحه دوره را در app.spotplayer.ir باز کن.');

    // استخراج مستقیم از DOM صفحه؛ دیگر به نصب یا پیام‌رسانی content.js وابسته نیست.
    let response=null;
    for(let attempt=0;attempt<16;attempt++){
      const injected=await chrome.scripting.executeScript({
        target:{tabId:tab.id},
        func:()=>{
          const links=[...document.querySelectorAll('#vids li.vid a[href], #vids a[href], li.vid a[href]')];
          const lessons=links.map((a,i)=>{
            try{
              const u=new URL(a.href,location.href);
              const file=(u.pathname.split('/').filter(Boolean).pop()||'');
              const m=file.match(/^([a-f0-9]{24})\.spot$/i);
              if(!m)return null;
              return {index:i+1,title:(a.textContent||'').trim()||`جلسه ${i+1}`,id:m[1].toLowerCase(),url:u.href};
            }catch(_){return null;}
          }).filter(Boolean);
          return {pageUrl:location.href,courseTitle:document.querySelector('#vids')?.closest('main')?.querySelector('h1')?.textContent?.trim()||document.querySelector('h1')?.textContent?.trim()||document.title||'دوره بدون عنوان',description:document.querySelector('header p')?.textContent?.trim()||'',lessons,extractedAt:new Date().toISOString(),ready:document.readyState};
        }
      });
      response=injected?.[0]?.result||null;
      if(response?.lessons?.length)break;
      await new Promise(resolve=>setTimeout(resolve,450));
    }
    if(!response?.lessons?.length) throw Error('جلسه‌ای پیدا نشد. صفحه دوره را باز نگه دار، صبر کن فهرست جلسات کامل بارگذاری شود و دوباره تلاش کن.');
    course={ok:true,...response};
    $('courseTitle').textContent=response.courseTitle;
    $('courseMeta').textContent=`${response.lessons.length} جلسه شناسایی شد`;
    $('pageState').textContent='شناسایی شد';
    comparison=null;
    $('summary').classList.add('hidden');
    $('csvBtn').disabled=true;
    $('selectAllExtra').disabled=true;
    $('quarantineBtn').disabled=true;
    $('results').className='results empty';
    $('results').textContent='اکنون پوشه فایل‌ها را انتخاب کن.';
    notify('دوره و جلسات با موفقیت شناسایی شدند.');
  } catch(e) {
    $('pageState').textContent='ناموفق';
    notify(e.message||'خطا در استخراج');
  } finally { $('extractBtn').disabled=false; }
}
async function chooseSource(){if(!course)return notify('ابتدا صفحه دوره را شناسایی کن.');if(!window.showDirectoryPicker)return notify('برای انتخاب پوشه از Chrome دسکتاپ به‌روز استفاده کن.');try{sourceRoot=await showDirectoryPicker({id:'spot-source',mode:'readwrite'});const perm=await sourceRoot.requestPermission({mode:'readwrite'});if(perm!=='granted')throw Error('اجازه خواندن و مدیریت فایل‌های پوشه داده نشد.');const ids=new Map();let count=0;async function walk(d,rel=''){for await(const h of d.values()){if(h.kind==='directory')await walk(h,rel+h.name+'/');else if(h.kind==='file'&&h.name.toLowerCase().endsWith('.spot')){count++;const id=h.name.slice(0,-5).toLowerCase();if(/^[a-f0-9]{24}$/.test(id)){if(!ids.has(id))ids.set(id,[]);ids.get(id).push({path:rel+h.name,relDir:rel,name:h.name})}}}}await walk(sourceRoot);const lessonIds=new Set(course.lessons.map(x=>x.id.toLowerCase()));const matched=course.lessons.filter(x=>ids.has(x.id.toLowerCase()));const missing=course.lessons.filter(x=>!ids.has(x.id.toLowerCase()));const extra=[...ids].filter(([id])=>!lessonIds.has(id)).flatMap(([id,items])=>items.map(x=>({...x,id})));comparison={matched,missing,extra};$('folderMeta').textContent=`${sourceRoot.name} · ${count} فایل SPOT بررسی شد`;$('matchedCount').textContent=matched.length;$('missingCount').textContent=missing.length;$('extraCount').textContent=extra.length;$('summary').classList.remove('hidden');$('csvBtn').disabled=false;$('selectAllExtra').disabled=!extra.length;$('quarantineBtn').disabled=!extra.length;render();notify('بررسی کامل شد؛ هنوز هیچ فایلی جابه‌جا نشده است.')}catch(e){if(e.name!=='AbortError')notify(e.message||'خطا در خواندن پوشه')}}
function render(){if(!comparison)return;const rows=[...comparison.matched.map(x=>({...x,status:'matched',label:'موجود'})),...comparison.missing.map(x=>({...x,status:'missing',label:'مفقود'})),...comparison.extra.map((x,i)=>({...x,title:x.path,status:'extra',label:'اضافی',extraIndex:i}))].filter(x=>activeFilter==='all'||x.status===activeFilter);$('results').className='results';$('results').innerHTML=rows.map(x=>`<div class="result">${x.status==='extra'?`<input class="extra-check" type="checkbox" data-extra="${x.extraIndex}" aria-label="انتخاب فایل">`:''}<div class="lesson"><b>${esc(x.title||'')}</b><code>${esc(x.id)}</code></div><span class="status ${x.status}">${x.label}</span></div>`).join('')||'<div class="empty">موردی در این دسته وجود ندارد.</div>'}
async function chooseDestination(){if(!window.showDirectoryPicker)return notify('انتخاب پوشه در این مرورگر پشتیبانی نمی‌شود.');try{destinationRoot=await showDirectoryPicker({id:'spot-quarantine',mode:'readwrite'});const p=await destinationRoot.requestPermission({mode:'readwrite'});if(p!=='granted')throw Error('اجازه نوشتن در پوشه مقصد داده نشد.');$('destMeta').textContent=`مقصد قرنطینه: ${destinationRoot.name}`;notify('پوشه مقصد قرنطینه انتخاب شد.')}catch(e){if(e.name!=='AbortError')notify(e.message||'انتخاب مقصد ناموفق بود.')}}
function selectedExtras(){return [...document.querySelectorAll('[data-extra]:checked')].map(el=>comparison.extra[Number(el.dataset.extra)]).filter(Boolean)}
$('selectAllExtra').addEventListener('click',()=>{document.querySelectorAll('[data-extra]').forEach(x=>x.checked=true)});
async function ensureDir(root,rel){let d=root;for(const part of rel.split('/').filter(Boolean))d=await d.getDirectoryHandle(part,{create:true});return d}
async function moveToQuarantine(item){const fromDir=await ensureDir(sourceRoot,item.relDir);const source=await fromDir.getFileHandle(item.name);const file=await source.getFile();const toDir=await ensureDir(destinationRoot,item.relDir);try{await toDir.getFileHandle(item.name);throw Error(`فایل هم‌نام در مقصد وجود دارد: ${item.name}`)}catch(e){if(e.name!=='NotFoundError')throw e}
const target=await toDir.getFileHandle(item.name,{create:true});const writable=await target.createWritable({keepExistingData:false});await writable.write(file);await writable.close();const copied=await target.getFile();if(copied.size!==file.size){await toDir.removeEntry(item.name);throw Error(`بررسی اندازه فایل ناموفق بود: ${item.name}`)}
const recordId=await dbAdd({courseTitle:course?.courseTitle||'',fileName:item.name,id:item.id,relDir:item.relDir,sourceRoot,destinationRoot,quarantinedAt:new Date().toISOString(),size:file.size});try{await fromDir.removeEntry(item.name)}catch(removeError){await dbDelete(recordId);await toDir.removeEntry(item.name);throw removeError}}
async function quarantine(){if(!comparison||!sourceRoot)return notify('ابتدا پوشه فایل‌ها را بررسی کن.');if(!destinationRoot)return notify('ابتدا پوشه مقصد قرنطینه را انتخاب کن.');if(await sourceRoot.isSameEntry(destinationRoot))return notify('پوشه مقصد باید جدا از پوشه اصلی فایل‌ها باشد.');const items=selectedExtras();if(!items.length)return notify('ابتدا فایل‌های اضافی موردنظر را انتخاب کن.');if(!confirm(`تعداد ${items.length} فایل به پوشه «${destinationRoot.name}» منتقل شود؟ فایل مبدأ پس از کپی و بررسی اندازه حذف خواهد شد.`))return;let ok=0,errors=[];for(const item of items){try{await moveToQuarantine(item);ok++}catch(e){errors.push(`${item.name}: ${e.message}`)}}$('quarantineMeta').textContent=`${ok} فایل منتقل شد${errors.length?` · ${errors.length} خطا`:''}`;await renderQuarantine();await chooseSourceAfterMove();notify(errors.length?`انتقال ${ok} فایل انجام شد؛ ${errors.length} مورد ناموفق بود. اولین خطا: ${errors[0]}`:`${ok} فایل با موفقیت به قرنطینه منتقل شد.`)}
async function chooseSourceAfterMove(){if(!sourceRoot||!course)return;const ids=new Map();async function walk(d,rel=''){for await(const h of d.values()){if(h.kind==='directory')await walk(h,rel+h.name+'/');else if(h.kind==='file'&&h.name.toLowerCase().endsWith('.spot')){const id=h.name.slice(0,-5).toLowerCase();if(/^[a-f0-9]{24}$/.test(id)){if(!ids.has(id))ids.set(id,[]);ids.get(id).push({path:rel+h.name,relDir:rel,name:h.name})}}}}await walk(sourceRoot);const s=new Set(course.lessons.map(x=>x.id.toLowerCase()));comparison={matched:course.lessons.filter(x=>ids.has(x.id.toLowerCase())),missing:course.lessons.filter(x=>!ids.has(x.id.toLowerCase())),extra:[...ids].filter(([id])=>!s.has(id)).flatMap(([id,items])=>items.map(x=>({...x,id})))};$('matchedCount').textContent=comparison.matched.length;$('missingCount').textContent=comparison.missing.length;$('extraCount').textContent=comparison.extra.length;$('selectAllExtra').disabled=!comparison.extra.length;$('quarantineBtn').disabled=!comparison.extra.length;render()}
async function renderQuarantine(announce=false){
  const button=$('refreshQuarantine');
  if(button){button.disabled=true;button.textContent='در حال بارگذاری…';}
  $('quarantineList').className='results';
  $('quarantineList').textContent='در حال خواندن سوابق قرنطینه…';
  try {
    const db=await openDB();
    const records=await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const store=tx.objectStore(STORE);
      const out=[];
      const req=store.openCursor();
      req.onsuccess=()=>{const c=req.result;if(c){const value=c.value||{};if(value.id===undefined)value.id=c.primaryKey;out.push(value);c.continue();}else resolve(out);};
      req.onerror=()=>reject(req.error||new Error('خواندن سوابق از پایگاه داده ناموفق بود.'));
      tx.onerror=()=>reject(tx.error||new Error('تراکنش پایگاه داده ناموفق بود.'));
    });
    quarantineCache=new Map(records.map(x=>[String(x.id),x]));
    const items=[...records].sort((a,b)=>String(b.quarantinedAt||'').localeCompare(String(a.quarantinedAt||'')));
    $('quarantineList').className='results';
    $('quarantineList').innerHTML=items.length?items.map(x=>`<div class="result"><div class="lesson"><b>${esc(x.fileName||'فایل بدون نام')}</b><code>${esc(x.courseTitle||'') } · ${x.quarantinedAt?new Date(x.quarantinedAt).toLocaleString('fa-IR'):'زمان نامشخص'}</code></div><button class="restore" data-restore="${esc(x.id)}">بازگردانی</button></div>`).join(''):'<div class="empty">هنوز سابقه‌ای ثبت نشده است.</div>';
    if(announce)notify(`${records.length} سابقه قرنطینه از پایگاه داده بارگذاری شد.`);
  } catch(e) {
    quarantineCache=new Map();
    $('quarantineList').className='results empty';
    $('quarantineList').textContent=`خطا در خواندن سوابق: ${e.message||'خطای نامشخص'}`;
    notify(`به‌روزرسانی سوابق ناموفق بود: ${e.message||'خطای نامشخص'}`);
  } finally {
    if(button){button.disabled=false;button.textContent='به‌روزرسانی';}
  }
}
async function restoreRecord(id){
  const rec=quarantineCache.get(String(id));
  if(!rec){
    notify('این سابقه در حافظهٔ فعلی بارگذاری نشده است. ابتدا «به‌روزرسانی» را بزن و پس از نمایش تعداد سوابق دوباره تلاش کن.');
    await renderQuarantine();
    return;
  }
  const button=document.querySelector(`[data-restore="${CSS.escape(String(id))}"]`);
  if(button){button.disabled=true;button.textContent='در حال بازگردانی…';}
  try {
    if(!rec.sourceRoot||!rec.destinationRoot) throw Error('اطلاعات پوشه‌های این سابقه در پایگاه داده موجود نیست؛ بدون آن‌ها مسیر اصلی فایل قابل تشخیص نیست.');
    // درخواست مجوزها پیش از اولین await و در همان رویداد کلیک آغاز می‌شوند.
    const sourcePermission=rec.sourceRoot.requestPermission({mode:'readwrite'});
    const quarantinePermission=rec.destinationRoot.requestPermission({mode:'readwrite'});
    const permissions=await Promise.all([sourcePermission,quarantinePermission]);
    if(permissions.some(x=>x!=='granted')) throw Error('اجازه دسترسی نوشتن به هر دو پوشه لازم است. دوباره بازگردانی را بزن و مجوزها را تأیید کن.');

    const qDir=await ensureDir(rec.destinationRoot,rec.relDir||'');
    const qHandle=await qDir.getFileHandle(rec.fileName);
    const file=await qHandle.getFile();
    if(Number.isFinite(rec.size)&&file.size!==rec.size) throw Error('اندازه فایل قرنطینه با اندازه ثبت‌شده مطابقت ندارد؛ برای جلوگیری از بازیابی فایل ناقص، عملیات متوقف شد.');
    const originalDir=await ensureDir(rec.sourceRoot,rec.relDir||'');
    try {
      await originalDir.getFileHandle(rec.fileName);
      throw Error('در محل اصلی فایلی با همین نام وجود دارد؛ برای جلوگیری از بازنویسی، بازگردانی انجام نشد.');
    } catch(e) { if(e.name!=='NotFoundError') throw e; }

    const target=await originalDir.getFileHandle(rec.fileName,{create:true});
    const writable=await target.createWritable({keepExistingData:false});
    await writable.write(file);
    await writable.close();
    const restored=await target.getFile();
    if(restored.size!==file.size){await originalDir.removeEntry(rec.fileName);throw Error('بررسی فایل بازگردانی‌شده ناموفق بود؛ فایل ناقص حذف شد.');}
    await qDir.removeEntry(rec.fileName);
    await dbDelete(id);
    quarantineCache.delete(String(id));
    await renderQuarantine();
    notify(`فایل ${rec.fileName} با موفقیت بازگردانی شد.`);
    if(sourceRoot&&await sourceRoot.isSameEntry(rec.sourceRoot)) await chooseSourceAfterMove();
  } catch(e) {
    notify(e.message||'بازگردانی ناموفق بود.');
    if(button){button.disabled=false;button.textContent='بازگردانی';}
  }
}
function csv(){if(!comparison)return;const rows=[['status','title_or_path','id'],...comparison.matched.map(x=>['matched',x.title,x.id]),...comparison.missing.map(x=>['missing',x.title,x.id]),...comparison.extra.map(x=>['extra',x.path,x.id])];const data='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='spot-cleaner-report.csv';a.click();URL.revokeObjectURL(url)}
$('extractBtn').addEventListener('click',extract);$('folderBtn').addEventListener('click',chooseSource);$('destBtn').addEventListener('click',chooseDestination);$('quarantineBtn').addEventListener('click',quarantine);$('csvBtn').addEventListener('click',csv);$('refreshQuarantine').addEventListener('click',()=>{renderQuarantine(true);});$('results').addEventListener('change',()=>{$('quarantineBtn').disabled=!selectedExtras().length});$('results').addEventListener('click',()=>{});$('quarantineList').addEventListener('click',e=>{const b=e.target.closest('[data-restore]');if(b)restoreRecord(b.dataset.restore)});document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));render()}));$('selectAllExtra').addEventListener('click',()=>{$('quarantineBtn').disabled=!selectedExtras().length});extract();renderQuarantine();
