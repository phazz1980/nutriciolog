const AI_ENDPOINT='https://my-nutritionist-advice.340052.workers.dev/api/advice';const planMeals={"Завтрак":[{name:"Омлет с овощами",calories:310}],"Обед":[{name:"Боул с курицей",calories:520}],"Ужин":[],"Перекус":[{name:"Яблоко и йогурт",calories:170}]};let editingPlan=null;let water=0;function show(id){document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.target===id))}function renderWater(){let html='';for(let i=0;i<8;i++)html+=`<button class="drop ${i<water?'full':''}" onclick="toggleWater(${i})">💧</button>`;drops.innerHTML=html;waterText.textContent=`${water} из 8 стаканов`}function addWater(){if(water<8)water++;renderWater();toast('Стакан воды добавлен')}function toggleWater(i){water=i+1;renderWater()}function openMeal(){modal.classList.add('show');mealName.focus()}function closeMeal(){modal.classList.remove('show')}function saveMeal(e){e.preventDefault();let n=mealName.value,c=calories.value,p=portion.value||'—';mealList.insertAdjacentHTML('beforeend',`<section class="card"><h2>🌙 ${mealType.value}</h2><div class="entry"><div><b>${n}</b><small>${p} г · вручную добавлено</small></div><b>${c} ккал</b></div></section>`);let total=+eaten.textContent.replaceAll(' ','')+(+c);eaten.textContent=total.toLocaleString('ru-RU');remain.textContent=Math.max(0,1800-total).toLocaleString('ru-RU')+' ккал';closeMeal();e.target.reset();show('diary');toast('Блюдо добавлено в дневник')}function addWeight(){toast('Запись веса: 65,4 кг')}function toast(t){let e=document.getElementById('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}function renderPlan(){const list=document.getElementById('planList');let total=0;list.innerHTML=Object.entries(planMeals).map(([type,items])=>{const sum=items.reduce((n,x)=>n+x.calories,0);total+=sum;return `<section class="card"><div class="section-head" style="margin:0 0 8px"><h2>${type}</h2><b>${sum} ккал</b></div>${items.length?items.map((x,i)=>`<button class="entry" style="width:100%;background:none;text-align:left" onclick="openPlanItem('${type}',${i})"><span><b>${x.name}</b><small>Нажмите, чтобы изменить</small></span><b>${x.calories} ккал</b></button>`).join(''):'<p class="hello">Ничего не запланировано</p>'}</section>`}).join('');plannedTotal.textContent=total.toLocaleString('ru-RU');const remaining=1800-total;plannedRemaining.textContent=(remaining>=0?remaining.toLocaleString('ru-RU'):'+'+Math.abs(remaining).toLocaleString('ru-RU'))+' ккал';planPercent.textContent=Math.round(total/18)+'%'}function openPlanItem(type,index){editingPlan=typeof index==='number'?{type,index}:null;planFormTitle.textContent=editingPlan?'Изменить блюдо':'Запланировать блюдо';planType.value=editingPlan?type:'Завтрак';planName.value=editingPlan?planMeals[type][index].name:'';planCalories.value=editingPlan?planMeals[type][index].calories:'';planModal.classList.add('show');planName.focus()}function closePlanItem(){planModal.classList.remove('show')}function savePlanItem(e){e.preventDefault();const type=planType.value;const item={name:planName.value.trim(),calories:Number(planCalories.value)};if(editingPlan){planMeals[editingPlan.type].splice(editingPlan.index,1);if(editingPlan.type!==type)planMeals[type].push(item);else planMeals[type].splice(editingPlan.index,0,item)}else planMeals[type].push(item);closePlanItem();renderPlan();toast('План обновлён')}async function askAI(e){e.preventDefault();const text=question.value.trim();chatlog.insertAdjacentHTML('beforeend',`<div class="bubble user"></div>`);chatlog.lastElementChild.textContent=text;question.value='';if(AI_ENDPOINT.includes('YOUR-WORKER')){chatlog.insertAdjacentHTML('beforeend','<div class="bubble">Сервер ещё не подключён. Следуйте README: укажите адрес Cloudflare Worker в константе AI_ENDPOINT.</div>');return}chatStatus.textContent='Формирую ответ…';try{const r=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ошибка сервиса');chatlog.insertAdjacentHTML('beforeend','<div class="bubble"></div>');chatlog.lastElementChild.textContent=d.advice;chatStatus.textContent='Ответ носит справочный характер.'}catch(err){chatStatus.textContent='Не удалось получить ответ: '+err.message}}renderWater();renderPlan();

async function getAiToken(){
  if(navigator.onLine===false){toast('Нет интернета. ИИ станет доступен после подключения.');return undefined}
  try{
    if(!window.getFirebaseIdToken){toast('Сервис входа ещё загружается. Подождите немного.');return undefined}
    const token=await window.getFirebaseIdToken();window.setAiTokenError?.('');return token;
  }catch(error){const message=window.getAuthErrorMessage?.(error)||'Не удалось проверить вход. Проверьте соединение и повторите действие.';window.setAiTokenError?.(message);toast(message);return undefined}
}

window.askAI=async function(e){e.preventDefault();const text=question.value.trim();chatlog.insertAdjacentHTML('beforeend','<div class="bubble user"></div>');chatlog.lastElementChild.textContent=text;question.value='';if(AI_ENDPOINT.includes('YOUR-WORKER')){chatlog.insertAdjacentHTML('beforeend','<div class="bubble">Сервер советов пока не подключён.</div>');return}chatStatus.textContent='Формирую ответ…';try{const r=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ошибка сервиса');chatlog.insertAdjacentHTML('beforeend','<div class="bubble"></div>');chatlog.lastElementChild.textContent=d.advice;chatStatus.textContent='Ответ носит справочный характер.';if(d.proposedMeal)showMealProposal(d.proposedMeal)}catch(err){chatStatus.textContent='Не удалось получить ответ: '+err.message}}
function showMealProposal(meal){const modal=document.createElement('div');modal.className='modal show';modal.innerHTML=`<section class="sheet"><h2>Добавить в дневник?</h2><p class="hello">ИИ предлагает: <b>${meal.title}</b> · ${meal.calories} ккал · ${meal.mealType||'Перекус'}</p><label class="field">Когда добавить<select><option value="today">Сегодня</option><option value="tomorrow">Завтра</option></select></label><p class="notice">Проверьте предложение перед сохранением. Блюдо не будет добавлено без вашего подтверждения.</p><button class="primary">Добавить</button><button class="link" style="display:block;margin:14px auto 0">Отмена</button></section>`;const [dateSelect,confirm,cancel]=modal.querySelectorAll('select,button');confirm.onclick=async()=>{try{const entry={...meal,date:dateKeyFor(dateSelect.value),mealType:meal.mealType||'Перекус',source:'ai-confirmed'};await window.addProposedMeal(entry);addDiaryEntryToView(entry);modal.remove();toast(`Блюдо добавлено на ${dateSelect.value==='today'?'сегодня':'завтра'}`)}catch{toast('Не удалось сохранить блюдо')}};cancel.onclick=()=>modal.remove();document.body.append(modal)}
async function showProductProposals(products){const list=Array.isArray(products)?products.slice(0,8):[];for(const proposal of list){if(!proposal||!proposal.title||!Number.isFinite(Number(proposal.calories)))continue;let product={...proposal};try{const saved=await window.nutritionStore?.loadProduct?.(proposal.title);if(saved)product={...product,...saved,mealType:proposal.mealType||'Перекус'}}catch{}const basePortion=Number(product.portion);const card=document.createElement('section');card.className='card';const title=document.createElement('h2');title.textContent=product.title;const details=document.createElement('p');details.className='hello';const weightLabel=document.createElement('label');weightLabel.className='field';weightLabel.textContent='Вес порции, г';const weightInput=document.createElement('input');weightInput.type='number';weightInput.min='1';weightInput.step='1';weightInput.inputMode='numeric';weightInput.value=Number.isFinite(basePortion)&&basePortion>0?basePortion:'';weightInput.placeholder='Например, 250';weightLabel.append(weightInput);const scaledProduct=()=>{const weight=Number(weightInput.value);if(!Number.isFinite(weight)||weight<=0)return null;const ratio=basePortion>0?weight/basePortion:1;return {...product,portion:weight,calories:Math.round(Number(product.calories)*ratio),protein:Number((Number(product.protein||0)*ratio).toFixed(1)),fat:Number((Number(product.fat||0)*ratio).toFixed(1)),carbs:Number((Number(product.carbs||0)*ratio).toFixed(1))}};const renderDetails=()=>{const entry=scaledProduct()||product;details.textContent=`${entry.portion||'—'} г · ${entry.calories} ккал · Б ${entry.protein||0} г · Ж ${entry.fat||0} г · У ${entry.carbs||0} г`};renderDetails();weightInput.oninput=renderDetails;const label=document.createElement('label');label.className='field';label.textContent='Приём пищи';const select=document.createElement('select');['Завтрак','Обед','Ужин','Перекус'].forEach(type=>{const option=document.createElement('option');option.value=type;option.textContent=type;option.selected=type===(product.mealType||'Перекус');select.append(option)});label.append(select);const dateLabel=document.createElement('label');dateLabel.className='field';dateLabel.textContent='Когда добавить';const dateSelect=document.createElement('select');[['today','Сегодня'],['tomorrow','Завтра']].forEach(([value,text])=>dateSelect.add(new Option(text,value)));dateLabel.append(dateSelect);const button=document.createElement('button');button.className='primary';button.type='button';button.textContent='Добавить';button.onclick=async()=>{const entry=scaledProduct();if(!entry){weightInput.focus();toast('Укажите вес порции в граммах');return}button.disabled=true;try{await window.addProposedProduct({...entry,mealType:select.value,date:dateKeyFor(dateSelect.value),source:'ai-product-confirmed'});addDiaryEntryToView({...entry,mealType:select.value,date:dateKeyFor(dateSelect.value)});card.remove();toast(`Продукт добавлен на ${dateSelect.value==='today'?'сегодня':'завтра'} и в личную базу`)}catch{button.disabled=false;toast('Не удалось сохранить продукт')}};card.append(title,details,weightLabel,label,dateLabel,button);chatlog.append(card)}}

let selectedPhoto=null;mealPhoto?.addEventListener('change',async()=>{const file=mealPhoto.files[0];if(!file){selectedPhoto=null;photoPreview.style.display='none';return}if(file.size>4*1024*1024){toast('Фото должно быть не больше 4 МБ');mealPhoto.value='';return}selectedPhoto={dataUrl:await new Promise((ok,no)=>{const r=new FileReader;r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)}),mimeType:file.type};photoPreview.style.display='block';photoPreview.innerHTML=`Фото: ${file.name} <button class="link" type="button" onclick="removePhoto()">Удалить</button>`});function removePhoto(){selectedPhoto=null;mealPhoto.value='';photoPreview.style.display='none'}window.askAI=async function(e){e.preventDefault();const text=question.value.trim();chatlog.insertAdjacentHTML('beforeend','<div class="bubble user"></div>');chatlog.lastElementChild.textContent=text;question.value='';if(AI_ENDPOINT.includes('YOUR-WORKER')){chatlog.insertAdjacentHTML('beforeend','<div class="bubble">Сервер советов пока не подключён.</div>');return}chatStatus.textContent='Формирую ответ…';try{const r=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,image:selectedPhoto})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Ошибка сервиса');chatlog.insertAdjacentHTML('beforeend','<div class="bubble"></div>');chatlog.lastElementChild.textContent=d.advice;chatStatus.textContent='Ответ носит справочный характер.';if(d.proposedMeal)showMealProposal(d.proposedMeal);removePhoto()}catch(err){chatStatus.textContent='Не удалось получить ответ: '+err.message}}

const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;let recognition=null,voiceOn=true;function setVoiceStatus(text){voiceStatus.textContent=text}function toggleSpeech(){voiceOn=!voiceOn;speechToggle.textContent=`🔊 Озвучивание ответа: ${voiceOn?'вкл.':'выкл.'}`;if(!voiceOn)speechSynthesis.cancel()}function toggleVoice(){if(!Recognition){setVoiceStatus('Голосовой ввод не поддерживается этим браузером. Введите вопрос текстом.');return}if(recognition){recognition.stop();return}recognition=new Recognition();recognition.lang='ru-RU';recognition.interimResults=true;recognition.continuous=false;micButton.textContent='■';setVoiceStatus('Слушаю… Нажмите ■ для отмены.');recognition.onresult=e=>{question.value=Array.from(e.results).map(r=>r[0].transcript).join('')};recognition.onerror=e=>{setVoiceStatus(e.error==='not-allowed'?'Нет доступа к микрофону. Разрешите его или используйте текст.':'Не удалось распознать речь. Попробуйте ещё раз.')};recognition.onend=()=>{const shouldSend=question.value.trim();recognition=null;micButton.textContent='🎙';if(shouldSend){setVoiceStatus('Отправляю распознанный вопрос…');window.askAI({preventDefault(){}})}else setVoiceStatus('Голосовой ввод отменён.')};recognition.start()}const askWithVoice=window.askAI;window.askAI=async function(e){const before=chatlog.children.length;await askWithVoice(e);if(voiceOn&&chatlog.children.length>before){const answer=chatlog.lastElementChild?.textContent;if(answer&&'speechSynthesis'in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(answer);utterance.lang='ru-RU';speechSynthesis.speak(utterance)}}}

let voiceCancelled=false;window.toggleVoice=function(){if(!Recognition){setVoiceStatus('Голосовой ввод не поддерживается этим браузером. Введите вопрос текстом.');return}if(recognition){voiceCancelled=true;recognition.abort();return}voiceCancelled=false;recognition=new Recognition();recognition.lang='ru-RU';recognition.interimResults=true;recognition.continuous=false;micButton.textContent='■';setVoiceStatus('Слушаю… Нажмите ■ для отмены.');recognition.onresult=e=>{question.value=Array.from(e.results).map(r=>r[0].transcript).join('')};recognition.onerror=e=>{if(e.error==='not-allowed')setVoiceStatus('Нет доступа к микрофону. Разрешите его или используйте текст.');else if(e.error!=='aborted')setVoiceStatus('Не удалось распознать речь. Попробуйте ещё раз.')};recognition.onend=()=>{const shouldSend=question.value.trim()&&!voiceCancelled;recognition=null;micButton.textContent='🎙';if(shouldSend){setVoiceStatus('Отправляю распознанный вопрос…');window.askAI({preventDefault(){}})}else setVoiceStatus('Голосовой ввод отменён.')};recognition.start()}

function setAiDebug(text){const panel=document.getElementById('aiDebug');if(!panel)return;panel.textContent=`Отладка: ${text}`;panel.style.display='block'}
window.askAI=async function(e){e.preventDefault();const text=question.value.trim();if(!text)return;const token=await getAiToken();if(token===undefined)return;if(!token){chatStatus.textContent='Войдите через Google в профиле, чтобы воспользоваться ИИ.';show('profile');return}const before=chatlog.children.length;chatlog.insertAdjacentHTML('beforeend','<div class="bubble user"></div>');chatlog.lastElementChild.textContent=text;question.value='';chatStatus.textContent='Формирую ответ…';setAiDebug('запрос отправлен');try{const r=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:text,image:selectedPhoto})});const d=await r.json();if(!r.ok){setAiDebug(`Worker ответил HTTP ${r.status}`);throw new Error(d.error||'Ошибка сервиса')}setAiDebug('Worker ответил успешно');chatlog.insertAdjacentHTML('beforeend','<div class="bubble"></div>');chatlog.lastElementChild.textContent=d.advice;chatStatus.textContent='Ответ носит справочный характер.';if(d.proposedProducts)await showProductProposals(d.proposedProducts);if(d.proposedMeal)showMealProposal(d.proposedMeal);removePhoto();if(voiceOn&&chatlog.children.length>before&&'speechSynthesis'in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(d.advice);utterance.lang='ru-RU';speechSynthesis.speak(utterance)}}catch(err){const status=document.getElementById('aiDebug')?.textContent||'';if(!status.includes('HTTP'))setAiDebug('ошибка запроса');chatStatus.textContent='Не удалось получить ответ: '+err.message}}
const APP_VERSION='v0.2.27';const RELEASE_DATE='29 сентября 2026';const defaultProfile={name:'Анна',age:27,height:165,weight:65.4,targetWeight:62,goal:'Похудение',calories:1800};let currentProfile={...defaultProfile};let currentAccount={};let profileNameReady=false;let profileNameFallbackTimer;let profileLoadVersion=0;
function formatNumber(value){return Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})}
function firstName(name){return String(name||'').trim().split(/\s+/)[0]||''}
function renderProfile(){document.getElementById('profileName').textContent=profileNameReady?currentProfile.name:'Загружаем профиль…';const avatar=document.getElementById('profileAvatar');avatar.replaceChildren();if(currentAccount.photoUrl){const photo=document.createElement('img');photo.src=currentAccount.photoUrl;photo.alt='Фото профиля Google';photo.referrerPolicy='no-referrer';photo.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';avatar.append(photo)}else avatar.textContent='🌿';document.getElementById('profileSummary').textContent=` · ${currentProfile.age} лет · ${formatNumber(currentProfile.height)} см · ${formatNumber(currentProfile.weight)} кг`;document.getElementById('profileGoal').textContent=currentProfile.goal;document.getElementById('profileRate').textContent=`Цель: ${formatNumber(currentProfile.targetWeight)} кг`;document.getElementById('profileCalories').textContent=`${formatNumber(currentProfile.calories)} ккал`;document.getElementById('releaseInfo').textContent=`Версия ${APP_VERSION} · ${RELEASE_DATE}`}
const releaseInfo=document.getElementById('releaseInfo');document.querySelector('#profile .top').append(releaseInfo);const renderProfileWithVersion=renderProfile;renderProfile=()=>{renderProfileWithVersion();releaseInfo.textContent=APP_VERSION};
function shouldUseAccountName(saved,account){return Boolean(firstName(account.name))&&(!saved||!saved.name||saved.name===defaultProfile.name)}
function applyProfile(saved,account){currentAccount=account;currentProfile={...defaultProfile,...(saved||{})};if(shouldUseAccountName(saved,account))currentProfile.name=firstName(account.name);profileNameReady=Boolean(firstName(account.name))||Boolean(saved?.name&&saved.name!==defaultProfile.name);if(profileNameReady)clearTimeout(profileNameFallbackTimer);renderProfile();window.renderNutrition?.()}
async function loadProfile(){if(!window.nutritionStore)return;const version=++profileLoadVersion;let saved=null;try{saved=await window.nutritionStore.loadProfile()}catch{}if(version!==profileLoadVersion)return;applyProfile(saved,window.nutritionStore.getAccountProfileDefaults())}
function refreshProfileFromAccount(){if(!window.nutritionStore)return;const account=window.nutritionStore.getAccountProfileDefaults();if(account.uid!==currentAccount.uid){profileLoadVersion++;applyProfile(null,account)}loadProfile()}
window.addEventListener('nutrition-profile-updated',event=>{const account=window.nutritionStore?.getAccountProfileDefaults();if(!account?.uid||account.uid!==event.detail.uid)return;profileLoadVersion++;applyProfile(event.detail.profile,account)});
function openProfileEditor(){const account=window.nutritionStore?.getAccountProfileDefaults?.()||{};if(firstName(account.name)&&currentProfile.name===defaultProfile.name){currentProfile.name=firstName(account.name);currentAccount=account;renderProfile()}document.getElementById('profileNameInput').value=currentProfile.name;document.getElementById('profileAgeInput').value=currentProfile.age;document.getElementById('profileHeightInput').value=currentProfile.height;document.getElementById('profileWeightInput').value=currentProfile.weight;document.getElementById('profileTargetWeightInput').value=currentProfile.targetWeight;document.getElementById('profileGoalInput').value=currentProfile.goal;document.getElementById('profileCaloriesInput').value=currentProfile.calories;document.getElementById('profileModal').classList.add('show');document.getElementById('profileNameInput').focus()}
function closeProfileEditor(){document.getElementById('profileModal').classList.remove('show')}
async function saveProfile(event){event.preventDefault();const profile={name:document.getElementById('profileNameInput').value.trim(),age:Number(document.getElementById('profileAgeInput').value),height:Number(document.getElementById('profileHeightInput').value),weight:Number(document.getElementById('profileWeightInput').value),targetWeight:Number(document.getElementById('profileTargetWeightInput').value),goal:document.getElementById('profileGoalInput').value,calories:Number(document.getElementById('profileCaloriesInput').value)};if(!profile.name||!Object.values(profile).every(value=>typeof value!=='number'||Number.isFinite(value))){toast('Проверьте заполнение профиля');return}if(!window.nutritionStore){toast('Хранилище ещё загружается');return}const previousProfile=currentProfile,accountUid=currentAccount.uid;profileLoadVersion++;currentProfile=profile;renderProfile();window.renderNutrition?.();closeProfileEditor();toast('Профиль сохранён');try{await window.nutritionStore.saveProfile(profile)}catch{if(currentAccount.uid===accountUid){currentProfile=previousProfile;renderProfile();window.renderNutrition?.()}toast('Не удалось синхронизировать профиль. Попробуйте ещё раз.')}}
window.addEventListener('nutritionstore-ready',loadProfile);window.addEventListener('nutrition-auth-changed',refreshProfileFromAccount);profileNameFallbackTimer=setTimeout(()=>{profileNameReady=true;renderProfile();window.renderNutrition?.()},10_000);renderProfile();

const dataDateKey=()=>new Date().toISOString().slice(0,10);
function dateKeyFor(when){const date=new Date();if(when==='tomorrow')date.setDate(date.getDate()+1);return date.toISOString().slice(0,10)}
const todayNutrition={calories:0,protein:0,fat:0,carbs:0};
const safeNumber=value=>Number.isFinite(Number(value))?Number(value):0;
function nutritionTargets(){const calories=safeNumber(currentProfile?.calories);return{protein:Math.round(calories*.3/4),fat:Math.round(calories*.3/9),carbs:Math.round(calories*.4/4)}}
function renderNutrition(){const calories=safeNumber(currentProfile?.calories),targets=nutritionTargets(),format=value=>safeNumber(value).toLocaleString('ru-RU',{maximumFractionDigits:1}),setMacro=(name,total,target)=>{document.getElementById(`${name}Total`).textContent=`${format(total)} / ${format(target)} г`;document.getElementById(`${name}Bar`).style.width=`${Math.min(100,target?total/target*100:0)}%`};document.getElementById('greeting').textContent=`Доброе утро${profileNameReady&&currentProfile?.name?`, ${currentProfile.name}`:''}`;document.getElementById('todayTitle').textContent=`Сегодня, ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(new Date())}`;eaten.textContent=format(todayNutrition.calories);document.getElementById('calorieGoal').textContent=format(calories);remain.textContent=`${format(Math.max(0,calories-todayNutrition.calories))} ккал`;document.getElementById('goalPercent').textContent=`${Math.round(Math.min(100,calories?todayNutrition.calories/calories*100:0))}%`;setMacro('protein',todayNutrition.protein,targets.protein);setMacro('fat',todayNutrition.fat,targets.fat);setMacro('carbs',todayNutrition.carbs,targets.carbs)}
const mealTypeOrder=['Завтрак','Обед','Ужин','Перекус'];
function addDiaryEntryToView(entry){if(entry.date!==dataDateKey())return;todayNutrition.calories+=safeNumber(entry.calories);todayNutrition.protein+=safeNumber(entry.protein);todayNutrition.fat+=safeNumber(entry.fat);todayNutrition.carbs+=safeNumber(entry.carbs);renderNutrition();const empty=mealList.querySelector('.hello');if(empty?.closest('.card'))empty.closest('.card').remove();let card=mealList.querySelector(`[data-meal-type="${entry.mealType}"]`);if(!card){card=document.createElement('section');card.className='card';card.dataset.mealType=entry.mealType;const heading=document.createElement('h2');heading.textContent=entry.mealType;card.append(heading);const rank=mealTypeOrder.indexOf(entry.mealType);const next=Array.from(mealList.querySelectorAll('[data-meal-type]')).find(existing=>{const existingRank=mealTypeOrder.indexOf(existing.dataset.mealType);return existingRank>=0&&(rank<0||existingRank>rank)});mealList.insertBefore(card,next||null)}const item=document.createElement('div');item.className='entry';const description=document.createElement('div');const title=document.createElement('b');title.textContent=entry.title;const details=document.createElement('small');details.textContent=`${entry.portion||'—'} г · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;description.append(title,details);const calories=document.createElement('b');calories.textContent=`${entry.calories} ккал`;item.append(description,calories);card.append(item)}
const mealTypeRank=value=>{const rank=mealTypeOrder.indexOf(String(value||'').trim());return rank<0?mealTypeOrder.length:rank};let diaryLoadVersion=0;async function loadDiary(){if(!window.nutritionStore?.loadDiaryEntries)return;const version=++diaryLoadVersion;todayNutrition.calories=0;todayNutrition.protein=0;todayNutrition.fat=0;todayNutrition.carbs=0;mealList.innerHTML='<section class="card"><p class="hello">Записей пока нет. Добавьте первый продукт или блюдо.</p></section>';renderNutrition();try{const entries=await window.nutritionStore.loadDiaryEntries(dataDateKey());if(version!==diaryLoadVersion)return;entries.sort((left,right)=>mealTypeRank(left.mealType)-mealTypeRank(right.mealType)).forEach(entry=>window.addDiaryEntryToView(entry))}catch{if(version===diaryLoadVersion)toast('Не удалось загрузить дневник. Попробуйте обновить страницу.') }}
function persistUserData(method,value){if(!window.nutritionStore?.[method])return;window.nutritionStore[method](value).catch(()=>toast('Не удалось синхронизировать данные. Они останутся на этом устройстве.'))}
let waterLogDate=dataDateKey();async function loadWater(){const date=dataDateKey();waterLogDate=date;try{const saved=await window.nutritionStore?.loadWaterLog?.(date);if(waterLogDate!==date||dataDateKey()!==date)return;water=Math.max(0,Math.min(8,Math.round(Number(saved?.glasses)||0)));renderWater()}catch{if(waterLogDate===date){water=0;renderWater()}}}function ensureWaterDate(){const date=dataDateKey();if(waterLogDate===date)return;waterLogDate=date;water=0;renderWater()}function saveWaterLog(){persistUserData('saveWaterLog',{date:waterLogDate,glasses:water})}
window.addWater=function(){ensureWaterDate();if(water<8)water++;renderWater();saveWaterLog();toast('Стакан воды добавлен')};
window.toggleWater=function(index){ensureWaterDate();water=index+1;renderWater();saveWaterLog()};
window.addEventListener('nutritionstore-ready',loadWater);window.addEventListener('nutrition-auth-changed',loadWater);setInterval(()=>{if(dataDateKey()!==waterLogDate)loadWater()},60_000);
window.saveMeal=function(event){event.preventDefault();const title=mealName.value.trim(),caloriesValue=safeNumber(calories.value),portionValue=safeNumber(portion.value)||null,type=mealType.value,date=dateKeyFor(mealDate.value),entry={date,mealType:type,title,portion:portionValue,calories:caloriesValue,protein:safeNumber(document.getElementById('protein').value),fat:safeNumber(document.getElementById('fat').value),carbs:safeNumber(document.getElementById('carbs').value),source:'manual'};addDiaryEntryToView(entry);persistUserData('saveDiaryEntry',entry);closeMeal();event.target.reset();show('diary');toast(`Блюдо добавлено на ${mealDate.value==='today'?'сегодня':'завтра'}`)};
window.renderNutrition=renderNutrition;renderNutrition();
window.savePlanItem=function(event){event.preventDefault();const type=planType.value,item={name:planName.value.trim(),calories:Number(planCalories.value)};if(editingPlan){planMeals[editingPlan.type].splice(editingPlan.index,1);if(editingPlan.type!==type)planMeals[type].push(item);else planMeals[type].splice(editingPlan.index,0,item)}else planMeals[type].push(item);closePlanItem();renderPlan();persistUserData('saveDayPlan',{date:dataDateKey(),meals:JSON.parse(JSON.stringify(planMeals))});toast('План обновлён')};
window.openPlanItem=function(type,index){editingPlan=typeof index==='number'?{type,index}:null;planFormTitle.textContent=editingPlan?'Изменить блюдо':'Запланировать блюдо';planType.value=editingPlan?type:'Завтрак';planName.value=editingPlan?planMeals[type][index].name:'';planCalories.value=editingPlan?planMeals[type][index].calories:'';let button=document.getElementById('deletePlanItemButton');if(!button){button=document.createElement('button');button.id='deletePlanItemButton';button.type='button';button.className='link';button.style.cssText='display:none;margin:14px auto 0;color:#b44747';button.textContent='Удалить блюдо';button.onclick=window.deletePlanItem;planModal.querySelector('form').append(button)}button.style.display=editingPlan?'block':'none';planModal.classList.add('show');planName.focus()};
window.deletePlanItem=function(){if(!editingPlan)return;planMeals[editingPlan.type].splice(editingPlan.index,1);closePlanItem();renderPlan();persistUserData('saveDayPlan',{date:dataDateKey(),meals:JSON.parse(JSON.stringify(planMeals))});toast('Блюдо удалено из плана')};
window.addDiaryEntryToView=function(entry){if(entry.date!==dataDateKey())return;todayNutrition.calories+=safeNumber(entry.calories);todayNutrition.protein+=safeNumber(entry.protein);todayNutrition.fat+=safeNumber(entry.fat);todayNutrition.carbs+=safeNumber(entry.carbs);renderNutrition();const empty=mealList.querySelector('.hello');if(empty?.closest('.card'))empty.closest('.card').remove();let card=mealList.querySelector(`[data-meal-type="${entry.mealType}"]`);if(!card){card=document.createElement('section');card.className='card';card.dataset.mealType=entry.mealType;const heading=document.createElement('h2');heading.textContent=`${({Завтрак:'☀️',Обед:'🍽️',Ужин:'🌙',Перекус:'🍏'})[entry.mealType]||'🍽️'} ${entry.mealType}`;card.append(heading);mealList.append(card)}const item=document.createElement('div');item.className='entry';const description=document.createElement('div');const title=document.createElement('b');title.textContent=entry.title;const details=document.createElement('small');details.textContent=`${entry.portion||'—'} г · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;description.append(title,details);const calories=document.createElement('b');calories.textContent=`${entry.calories} ккал`;item.append(description,calories);card.append(item)};
const renderDiaryEntryWithDelete=window.addDiaryEntryToView;window.addDiaryEntryToView=function(entry){entry.id ||= crypto.randomUUID();renderDiaryEntryWithDelete(entry);if(entry.date!==dataDateKey())return;const card=mealList.querySelector(`[data-meal-type="${entry.mealType}"]`),item=card?.lastElementChild;if(!item||item.dataset.entryId)return;item.dataset.entryId=entry.id;const remove=document.createElement('button');remove.type='button';remove.className='link';remove.style.cssText='margin-left:10px;color:#b44747;font-size:18px';remove.textContent='×';remove.setAttribute('aria-label',`Удалить: ${entry.title}`);remove.onclick=()=>window.deleteDiaryEntry(entry.id);item.append(remove)};
window.deleteDiaryEntry=async function(id){try{await window.nutritionStore.deleteDiaryEntry(id);await loadDiary();toast('Запись удалена из дневника')}catch{toast('Не удалось удалить запись. Попробуйте ещё раз.')}};
const renderDiaryEntry=window.addDiaryEntryToView;window.addDiaryEntryToView=function(entry){renderDiaryEntry(entry);Array.from(mealList.querySelectorAll('[data-meal-type]')).sort((left,right)=>{const leftRank=mealTypeOrder.indexOf(left.dataset.mealType),rightRank=mealTypeOrder.indexOf(right.dataset.mealType);return(leftRank<0?mealTypeOrder.length:leftRank)-(rightRank<0?mealTypeOrder.length:rightRank)}).forEach(card=>mealList.append(card))};
window.renderPlan=function(){const icons={Завтрак:'☀️',Обед:'🍽️',Ужин:'🌙',Перекус:'🍏'},list=document.getElementById('planList');let total=0;list.innerHTML=Object.entries(planMeals).map(([type,items])=>{const sum=items.reduce((value,item)=>value+item.calories,0);total+=sum;return `<section class="card"><div class="section-head" style="margin:0 0 8px"><h2>${icons[type]||'🍽️'} ${type}</h2><b>${sum} ккал</b></div>${items.length?items.map((item,index)=>`<button class="entry" style="width:100%;background:none;text-align:left" onclick="openPlanItem('${type}',${index})"><span><b>${item.name}</b><small>Нажмите, чтобы изменить</small></span><b>${item.calories} ккал</b></button>`).join(''):'<p class="hello">Ничего не запланировано</p>'}</section>`}).join('');plannedTotal.textContent=total.toLocaleString('ru-RU');const remaining=safeNumber(currentProfile?.calories)-total;plannedRemaining.textContent=(remaining>=0?remaining.toLocaleString('ru-RU'):'+'+Math.abs(remaining).toLocaleString('ru-RU'))+' ккал';planPercent.textContent=`${Math.round(Math.max(0,total/(safeNumber(currentProfile?.calories)||1)*100))}%`};window.renderPlan();
window.addWeight=function(){const weight=Number(currentProfile?.weight)||65.4;persistUserData('saveWeightEntry',{date:dataDateKey(),weight});toast(`Запись веса: ${weight.toLocaleString('ru-RU')} кг`)};

window.openAiDiary=function(){show('assistant');requestAnimationFrame(()=>{question.focus();question.scrollIntoView({block:'center',behavior:'smooth'})})};const diaryAddButton=document.querySelector('#diary .top .secondary');if(diaryAddButton){const aiButton=document.createElement('button');aiButton.type='button';aiButton.className='secondary';aiButton.textContent='✦ С ИИ';aiButton.style.cssText='margin-left:6px;white-space:nowrap';aiButton.onclick=window.openAiDiary;diaryAddButton.before(aiButton);const hint=document.createElement('p');hint.className='hello';hint.style.margin='10px 2px 0';hint.textContent='Добавьте с ИИ: напишите или скажите, что съели — ассистент подготовит продукты для подтверждения.';diaryAddButton.closest('header').after(hint)}

const diaryIcons={Завтрак:'☀️',Обед:'🍽️',Ужин:'🌙',Перекус:'🍏'};
window.addDiaryEntryToView=function(entry){if(entry.date!==dataDateKey())return;entry.id||=crypto.randomUUID();todayNutrition.calories+=safeNumber(entry.calories);todayNutrition.protein+=safeNumber(entry.protein);todayNutrition.fat+=safeNumber(entry.fat);todayNutrition.carbs+=safeNumber(entry.carbs);renderNutrition();const empty=mealList.querySelector('.hello');if(empty?.closest('.card'))empty.closest('.card').remove();let card=mealList.querySelector(`[data-meal-type="${entry.mealType}"]`);if(!card){card=document.createElement('section');card.className='card';card.dataset.mealType=entry.mealType;const heading=document.createElement('h2');heading.textContent=`${diaryIcons[entry.mealType]||'🍽️'} ${entry.mealType}`;card.append(heading);mealList.append(card)}const item=document.createElement('div');item.className='entry';item.dataset.entryId=entry.id;item.style.cssText='position:relative;padding-right:36px';const description=document.createElement('div');const title=document.createElement('b');title.textContent=entry.title;const details=document.createElement('small');details.textContent=`${entry.portion||'—'} г · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;description.append(title,details);const calories=document.createElement('b');calories.textContent=`${entry.calories} ккал`;const remove=document.createElement('button');remove.type='button';remove.className='link';remove.dataset.deleteDiaryEntry=entry.id;remove.textContent='×';remove.title=`Удалить ${entry.title}`;remove.setAttribute('aria-label',`Удалить ${entry.title}`);remove.style.cssText='position:absolute;right:0;top:8px;margin:0;padding:0 4px;color:#b44747;font-size:22px;line-height:1;font-weight:700';remove.onclick=event=>{event.stopPropagation();window.deleteDiaryEntry(entry.id,item)};item.append(description,calories,remove);card.append(item)};
mealList.addEventListener('click',event=>{const button=event.target.closest('[data-delete-diary-entry]');if(button)window.deleteDiaryEntry(button.dataset.deleteDiaryEntry)});
window.deleteDiaryEntry=async function(id){if(!id||!window.nutritionStore?.deleteDiaryEntry){toast('Не удалось определить запись для удаления');return}try{await window.nutritionStore.deleteDiaryEntry(id);await loadDiary();toast('Запись удалена из дневника')}catch{toast('Не удалось удалить запись. Попробуйте ещё раз.')}};
window.deleteDiaryEntry=async function(id,item){const row=item||Array.from(mealList.querySelectorAll('[data-entry-id]')).find(element=>element.dataset.entryId===id);if(!row){toast('Не удалось определить запись для удаления');return}const values={calories:Number((row.textContent.match(/([\d.,]+)\s*ккал/)||[,0])[1].replace(',','.')),protein:Number((row.textContent.match(/Б\s*([\d.,]+)/)||[,0])[1].replace(',','.')),fat:Number((row.textContent.match(/Ж\s*([\d.,]+)/)||[,0])[1].replace(',','.')),carbs:Number((row.textContent.match(/У\s*([\d.,]+)/)||[,0])[1].replace(',','.'))};const card=row.closest('[data-meal-type]');row.remove();if(card&&!card.querySelector('.entry'))card.remove();todayNutrition.calories=Math.max(0,todayNutrition.calories-safeNumber(values.calories));todayNutrition.protein=Math.max(0,todayNutrition.protein-safeNumber(values.protein));todayNutrition.fat=Math.max(0,todayNutrition.fat-safeNumber(values.fat));todayNutrition.carbs=Math.max(0,todayNutrition.carbs-safeNumber(values.carbs));renderNutrition();if(!window.nutritionStore?.deleteDiaryEntry){toast('Запись удалена. Для сохранения после перезагрузки откройте приложение через локальный сервер.');return}try{await window.nutritionStore.deleteDiaryEntry(id);toast('Запись удалена из дневника')}catch{await loadDiary();toast('Не удалось сохранить удаление. Попробуйте ещё раз.')}};
window.calculateMealNutrition=async function(){const title=document.getElementById('mealName').value.trim(),portionValue=Number(document.getElementById('portion').value);if(!title||!Number.isFinite(portionValue)||portionValue<=0){toast('Введите название блюда и вес порции');return}const token=await getAiToken();if(token===undefined)return;if(!token){toast('Для расчёта с ИИ войдите через Google в профиле');return}const button=document.getElementById('calculateMealButton');button.disabled=true;button.textContent='Рассчитываю…';try{const message=`Оцени пищевую ценность блюда «${title}» для порции ${portionValue} г. Верни один продукт с калориями, белками, жирами и углеводами именно для этой порции.`;const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка сервиса');const estimate=Array.isArray(data.proposedProducts)?data.proposedProducts[0]:data.proposedMeal;if(!estimate||!Number.isFinite(Number(estimate.calories)))throw new Error('ИИ не вернул расчёт');document.getElementById('calories').value=Math.round(Number(estimate.calories));document.getElementById('protein').value=Number(estimate.protein||0);document.getElementById('fat').value=Number(estimate.fat||0);document.getElementById('carbs').value=Number(estimate.carbs||0);toast('Калории и БЖУ заполнены — проверьте их перед сохранением')}catch(error){toast(`Не удалось рассчитать: ${error.message}`)}finally{button.disabled=false;button.textContent='✦ Рассчитать с ИИ'}};
const mealForm=document.querySelector('#modal form');if(mealForm&&!document.getElementById('calculateMealButton')){const calculateButton=document.createElement('button');calculateButton.id='calculateMealButton';calculateButton.type='button';calculateButton.className='secondary';calculateButton.style.cssText='width:100%;margin-top:4px';calculateButton.textContent='✦ Рассчитать с ИИ';calculateButton.onclick=window.calculateMealNutrition;mealForm.querySelector('.primary').before(calculateButton)}
window.showAuthRequiredDialog=function(){
  if(document.getElementById('authRequiredDialog'))return;
  const dialog=document.createElement('div');dialog.id='authRequiredDialog';dialog.className='modal show';
  dialog.innerHTML='<section class="sheet auth-sheet" role="dialog" aria-modal="true" aria-labelledby="authRequiredTitle" aria-describedby="authRequiredDescription"><div class="auth-mark" aria-hidden="true">🌿</div><p class="auth-brand">Мой нутрициолог</p><h2 id="authRequiredTitle">Войти в аккаунт</h2><p class="auth-description" id="authRequiredDescription">Сохраняйте свой дневник и получайте<br>подсказки ИИ о питании.</p><p class="auth-status" role="status" aria-live="polite"></p><button class="primary" type="button">Войти через Google</button><button class="link auth-later" type="button">Позже</button><p class="auth-note">Выбор аккаунта откроется в окне Google.<br>Ваш черновик блюда останется на месте.</p></section>';
  const [signIn,cancel]=dialog.querySelectorAll('button'),status=dialog.querySelector('[role="status"]');
  const previousFocus=document.activeElement;
  const refresh=()=>{const state=window.getFirebaseAuthStatus?.();signIn.disabled=Boolean(state?.pending);signIn.textContent=state?.pending?'Ожидаем вход…':'Войти через Google';dialog.querySelector('.auth-sheet').setAttribute('aria-busy',String(Boolean(state?.pending)));if(state?.message)status.textContent=state.message};
  const close=()=>{window.removeEventListener('nutrition-auth-status',refresh);dialog.remove();if(previousFocus?.isConnected)previousFocus.focus()};
  signIn.onclick=async()=>{
    const state=window.getFirebaseAuthStatus?.();
    if(!window.firebaseSignInWithGoogle||state?.state!=='ready'){close();show('profile');toast('Дождитесь подключения или повторите его в профиле');return}
    status.dataset.error='false';status.textContent='Загружается окно Google. При слабом интернете это может занять время.';
    try{await window.firebaseSignInWithGoogle();close();toast('Вход выполнен')}
    catch(error){refresh();status.dataset.error='true';status.textContent=window.getAuthErrorMessage?.(error)||'Не удалось войти. Проверьте интернет и повторите попытку.'}
  };
  dialog.onkeydown=event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const buttons=[...dialog.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}};
  cancel.onclick=close;window.addEventListener('nutrition-auth-status',refresh);document.body.append(dialog);refresh();(signIn.disabled?cancel:signIn).focus();
};
const calculateNutritionWithAuthCheck=window.calculateMealNutrition;window.calculateMealNutrition=async function(){const token=await getAiToken();if(token===undefined)return;if(!token){window.showAuthRequiredDialog();return}return calculateNutritionWithAuthCheck()};document.getElementById('calculateMealButton').onclick=window.calculateMealNutrition;
const mealNameField=document.getElementById('mealName')?.closest('.field'),portionField=document.getElementById('portion')?.closest('.field');if(mealNameField&&portionField){const nameAndPortionRow=document.createElement('div');nameAndPortionRow.className='row';mealNameField.before(nameAndPortionRow);mealNameField.style.flex='2';nameAndPortionRow.append(mealNameField,portionField);const portionInput=document.getElementById('portion');portionInput.required=true;portionInput.min='1';portionInput.removeAttribute('placeholder');document.getElementById('calories')?.removeAttribute('placeholder')}
if(portionField){const nameAndPortionRow=portionField.closest('.row');if(nameAndPortionRow)nameAndPortionRow.classList.add('meal-name-portion');mealNameField.style.flex='';portionField.style.flex='';portionField.style.width=''}
const caloriesField=document.getElementById('calories')?.closest('.field'),proteinField=document.getElementById('protein')?.closest('.field'),fatField=document.getElementById('fat')?.closest('.field'),carbsField=document.getElementById('carbs')?.closest('.field');const caloriesRow=caloriesField?.closest('.row'),fatRow=fatField?.closest('.row');if(caloriesRow&&proteinField)caloriesRow.append(proteinField);if(fatRow&&carbsField)fatRow.append(carbsField);
const portionInputForUnit=document.getElementById('portion');if(portionField&&portionInputForUnit&&!document.getElementById('portionUnit')){Array.from(portionField.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).forEach(node=>node.remove());const portionLabel=document.createElement('span');portionLabel.textContent='Порция, г / шт.';portionField.prepend(portionLabel);const portionUnit=document.createElement('input');portionUnit.id='portionUnit';portionUnit.type='hidden';portionUnit.value='г';portionField.append(portionUnit)}
const calculateNutritionWithUnit=window.calculateMealNutrition;window.calculateMealNutrition=async function(){const title=mealName.value.trim(),amount=Number(portion.value),unit=document.getElementById('portionUnit')?.value||'г';if(!validateMealEstimate())return;const token=await getAiToken();if(token===undefined)return;if(!token){window.showAuthRequiredDialog();return}const button=document.getElementById('calculateMealButton');button.disabled=true;button.textContent='Рассчитываю…';try{const countHint=unit==='шт.'?'Используй типичный вес одной штуки и рассчитай значения для указанного количества.':'';const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:`Оцени пищевую ценность блюда «${title}» для порции ${amount} ${unit}. ${countHint} Верни один продукт с калориями, белками, жирами и углеводами именно для этой порции.`})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка сервиса');const estimate=Array.isArray(data.proposedProducts)?data.proposedProducts[0]:data.proposedMeal;if(!estimate||!Number.isFinite(Number(estimate.calories)))throw new Error('ИИ не вернул расчёт');calories.value=Math.round(Number(estimate.calories));protein.value=Number(estimate.protein||0);fat.value=Number(estimate.fat||0);carbs.value=Number(estimate.carbs||0);toast('Калории и БЖУ заполнены — проверьте их перед сохранением')}catch(error){toast(`Не удалось рассчитать: ${error.message}`)}finally{button.disabled=false;button.textContent='✦ Рассчитать с ИИ'}};document.getElementById('calculateMealButton').onclick=window.calculateMealNutrition;
window.saveMeal=function(event){event.preventDefault();const title=mealName.value.trim(),amount=safeNumber(portion.value),unit=document.getElementById('portionUnit')?.value||'г',date=dateKeyFor(mealDate.value),entry={date,mealType:mealType.value,title,portion:amount,portionUnit:unit,calories:safeNumber(calories.value),protein:safeNumber(protein.value),fat:safeNumber(fat.value),carbs:safeNumber(carbs.value),source:'manual'};addDiaryEntryToView(entry);persistUserData('saveDiaryEntry',entry);closeMeal();event.target.reset();show('diary');toast(`Блюдо добавлено на ${mealDate.value==='today'?'сегодня':'завтра'}`)};
const renderDiaryWithUnit=window.addDiaryEntryToView;window.addDiaryEntryToView=function(entry){renderDiaryWithUnit(entry);if(entry.date!==dataDateKey()||!entry.portionUnit||entry.portionUnit==='г')return;const item=mealList.querySelector(`[data-entry-id="${entry.id}"]`);const details=item?.querySelector('small');if(details)details.textContent=`${entry.portion||'—'} ${entry.portionUnit} · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`};
const calculateNutritionWithSavedUnitWeight=window.calculateMealNutrition;window.calculateMealNutrition=async function(){const title=mealName.value.trim(),amount=Number(portion.value),unit=document.getElementById('portionUnit')?.value||'г';if(unit!=='шт.')return calculateNutritionWithSavedUnitWeight();if(!validateMealEstimate())return;const token=await getAiToken();if(token===undefined)return;if(!token){window.showAuthRequiredDialog();return}const button=document.getElementById('calculateMealButton');button.disabled=true;button.textContent='Рассчитываю…';try{const savedProduct=await window.nutritionStore?.loadProduct?.(title);const savedUnitWeight=Number(savedProduct?.unitWeight);const weightHint=Number.isFinite(savedUnitWeight)&&savedUnitWeight>0?`В личной базе указано: одна штука весит ${savedUnitWeight} г. Используй это значение.`:'Используй типичный вес одной штуки.';const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:`Оцени пищевую ценность блюда «${title}» для порции ${amount} шт. ${weightHint} Верни один продукт с калориями, белками, жирами и углеводами именно для этой порции. В поле portion верни общий вес порции в граммах.`})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка сервиса');const estimate=Array.isArray(data.proposedProducts)?data.proposedProducts[0]:data.proposedMeal;if(!estimate||!Number.isFinite(Number(estimate.calories)))throw new Error('ИИ не вернул расчёт');calories.value=Math.round(Number(estimate.calories));protein.value=Number(estimate.protein||0);fat.value=Number(estimate.fat||0);carbs.value=Number(estimate.carbs||0);window.lastCalculatedUnitWeight={title:title.toLocaleLowerCase('ru-RU'),weight:Number(estimate.portion)/amount};toast('Калории и БЖУ заполнены — проверьте их перед сохранением')}catch(error){toast(`Не удалось рассчитать: ${error.message}`)}finally{button.disabled=false;button.textContent='✦ Рассчитать с ИИ'}};document.getElementById('calculateMealButton').onclick=window.calculateMealNutrition;
window.saveMeal=function(event){event.preventDefault();const title=mealName.value.trim(),amount=safeNumber(portion.value),unit=document.getElementById('portionUnit')?.value||'г',date=dateKeyFor(mealDate.value),unitWeight=unit==='шт.'&&window.lastCalculatedUnitWeight?.title===title.toLocaleLowerCase('ru-RU')?window.lastCalculatedUnitWeight.weight:null,entry={date,mealType:mealType.value,title,portion:amount,portionUnit:unit,calories:safeNumber(calories.value),protein:safeNumber(protein.value),fat:safeNumber(fat.value),carbs:safeNumber(carbs.value),source:'manual'};addDiaryEntryToView(entry);persistUserData('saveDiaryEntry',entry);persistUserData('saveProduct',{title,portion:amount,unitWeight,calories:entry.calories,protein:entry.protein,fat:entry.fat,carbs:entry.carbs});closeMeal();event.target.reset();window.lastCalculatedUnitWeight=null;show('diary');toast(`Блюдо добавлено на ${mealDate.value==='today'?'сегодня':'завтра'}`)};
const countableFoodPattern=/яйцо|яиц|яйц|яблок|груш|банан|мандарин|апельсин|персик|слив|котлет|сырник|конфет|печень|кусоч|ломтик|булоч|пирож|йогурт|батончик/i;function resolvePortionUnit(title,amount){return Number.isInteger(amount)&&amount>0&&amount<10&&countableFoodPattern.test(title)?'шт.':'г'}function setAutomaticPortionUnit(){document.getElementById('portionUnit').value=resolvePortionUnit(mealName.value.trim(),Number(portion.value))}const calculateNutritionAutomatically=window.calculateMealNutrition;window.calculateMealNutrition=function(){setAutomaticPortionUnit();return calculateNutritionAutomatically()};const saveMealWithAutomaticUnit=window.saveMeal;window.saveMeal=function(event){setAutomaticPortionUnit();return saveMealWithAutomaticUnit(event)};document.getElementById('calculateMealButton').onclick=window.calculateMealNutrition;
window.showNutritionClarification=function(question){const dialog=document.createElement('div');dialog.className='modal show';dialog.innerHTML='<section class="sheet" role="dialog" aria-modal="true"><h2>Уточните блюдо</h2><p class="hello"></p><label class="field">Ваш ответ<input id="nutritionClarification" required placeholder="Например, с майонезом, 2 ложки"></label><button class="primary" type="button">Рассчитать</button><button class="link" type="button" style="display:block;margin:14px auto 0">Отмена</button></section>';dialog.querySelector('.hello').textContent=question;const [answer,submit,cancel]=dialog.querySelectorAll('input,button');submit.onclick=async()=>{const value=answer.value.trim();if(!value){answer.focus();return}dialog.remove();await window.calculateMealNutrition(value)};cancel.onclick=()=>dialog.remove();document.body.append(dialog);answer.focus()};
window.calculateMealNutrition=async function(clarification=''){setAutomaticPortionUnit();const title=mealName.value.trim(),amount=Number(portion.value),unit=document.getElementById('portionUnit').value;if(!validateMealEstimate())return;const token=await getAiToken();if(token===undefined)return;if(!token){window.showAuthRequiredDialog();return}const button=document.getElementById('calculateMealButton');button.disabled=true;button.textContent='Рассчитываю…';try{const savedProduct=unit==='шт.'?await window.nutritionStore?.loadProduct?.(title):null;const savedUnitWeight=Number(savedProduct?.unitWeight);const weightHint=unit==='шт.'?(Number.isFinite(savedUnitWeight)&&savedUnitWeight>0?`В личной базе указано: одна штука весит ${savedUnitWeight} г. Используй это значение.`:'Используй типичный вес одной штуки.'):'Количество указано в граммах.';const clarificationHint=clarification?`Пользователь уточнил: «${clarification}». Теперь выполни расчёт.`:'Если для сложного блюда не хватает важной детали, не рассчитывай наугад: верни пустой список продуктов и задай в поле advice один короткий уточняющий вопрос.';const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:`Оцени пищевую ценность блюда «${title}» для порции ${amount} ${unit}. ${weightHint} ${clarificationHint} Верни один продукт с калориями, белками, жирами и углеводами именно для этой порции. В поле portion верни общий вес порции в граммах.`})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка сервиса');const estimate=Array.isArray(data.proposedProducts)?data.proposedProducts[0]:data.proposedMeal;if(!estimate||!Number.isFinite(Number(estimate.calories))){if(typeof data.advice==='string'&&data.advice.trim()){window.showNutritionClarification(data.advice);return}throw new Error('ИИ не вернул расчёт')}calories.value=Math.round(Number(estimate.calories));protein.value=Number(estimate.protein||0);fat.value=Number(estimate.fat||0);carbs.value=Number(estimate.carbs||0);window.lastCalculatedUnitWeight=unit==='шт.'?{title:title.toLocaleLowerCase('ru-RU'),weight:Number(estimate.portion)/amount}:null;toast('Калории и БЖУ заполнены — проверьте их перед сохранением')}catch(error){toast(`Не удалось рассчитать: ${error.message}`)}finally{button.disabled=false;button.textContent='✦ Рассчитать с ИИ'}};document.getElementById('calculateMealButton').onclick=()=>window.calculateMealNutrition();
const nutritionPrecisionHint=document.createElement('p');nutritionPrecisionHint.className='hello';nutritionPrecisionHint.id='nutritionPrecisionHint';nutritionPrecisionHint.textContent='Чем подробнее опишете ингредиенты и способ приготовления, тем точнее будет расчёт.';const nutritionCalculateButton=document.getElementById('calculateMealButton');if(nutritionCalculateButton&&!document.getElementById('nutritionPrecisionHint'))nutritionCalculateButton.before(nutritionPrecisionHint);
const renderNutritionBase=renderNutrition;renderNutrition=function(){renderNutritionBase();const proteinTarget=nutritionTargets().protein,proteinRatio=proteinTarget?todayNutrition.protein/proteinTarget:0;document.getElementById('proteinBar')?.closest('.bar')?.classList.toggle('orange',proteinRatio<.8||proteinRatio>1.15)};window.renderNutrition=renderNutrition;renderNutrition();
window.showNutritionClarification=function(question){const dialog=document.createElement('div');dialog.className='modal show';dialog.innerHTML='<section class="sheet" role="dialog" aria-modal="true"><h2>Уточните блюдо</h2><p class="hello"></p><label class="field">Ваш ответ<input id="nutritionClarification" required placeholder="Например, с майонезом, 2 ложки"></label><button class="primary" type="button">Рассчитать</button><button class="link" type="button" style="display:block;margin:14px auto 0">Отмена</button></section>';dialog.querySelector('.hello').textContent=question;const [answer,submit,cancel]=dialog.querySelectorAll('input,button');submit.onclick=async()=>{const value=answer.value.trim();if(!value){answer.focus();return}dialog.remove();await window.calculateMealNutrition(value)};cancel.onclick=()=>dialog.remove();document.body.append(dialog);answer.focus()};
window.showNutritionClarification=function(question){const dialog=document.createElement('div');dialog.className='modal show';dialog.innerHTML='<section class="sheet" role="dialog" aria-modal="true"><h2>Уточните блюдо</h2><p class="hello"></p><label class="field">Ваш ответ<input id="nutritionClarification" required placeholder="Например, с майонезом, 2 ложки"></label><button class="primary" type="button">Рассчитать</button><button class="link" type="button" style="display:block;margin:14px auto 0">Отмена</button></section>';dialog.querySelector('.hello').textContent=question;const [answer,submit,cancel]=dialog.querySelectorAll('input,button');submit.onclick=async()=>{const value=answer.value.trim();if(!value){answer.focus();return}window.lastNutritionClarification={title:mealName.value.trim().toLocaleLowerCase('ru-RU'),question:String(question).trim(),additionalIngredients:value};dialog.remove();await window.calculateMealNutrition(value)};cancel.onclick=()=>dialog.remove();document.body.append(dialog);answer.focus()};
const saveMealWithClarificationMetadata=window.saveMeal;window.saveMeal=function(event){const title=mealName.value.trim(),clarification=window.lastNutritionClarification,hasClarification=clarification?.title===title.toLocaleLowerCase('ru-RU'),unit=document.getElementById('portionUnit')?.value||'г',unitWeight=unit==='шт.'&&window.lastCalculatedUnitWeight?.title===title.toLocaleLowerCase('ru-RU')?window.lastCalculatedUnitWeight.weight:null,product=hasClarification?{title,portion:safeNumber(portion.value),unitWeight,calories:safeNumber(calories.value),protein:safeNumber(protein.value),fat:safeNumber(fat.value),carbs:safeNumber(carbs.value),aiClarification:{question:clarification.question,additionalIngredients:clarification.additionalIngredients}}:null;saveMealWithClarificationMetadata(event);if(product)persistUserData('saveProduct',product);window.lastNutritionClarification=null};
const mealClarificationHint=document.createElement('p');mealClarificationHint.id='mealClarificationHint';mealClarificationHint.className='hello';mealClarificationHint.hidden=true;mealNameField?.after(mealClarificationHint);async function showSavedMealClarification(){const title=mealName.value.trim();if(!title||!window.nutritionStore?.loadProduct){mealClarificationHint.hidden=true;return}try{const saved=await window.nutritionStore.loadProduct(title),clarification=saved?.aiClarification;if(mealName.value.trim()!==title||!clarification?.additionalIngredients){mealClarificationHint.hidden=true;return}mealClarificationHint.textContent=`Ранее уточняли: ${clarification.additionalIngredients}`;mealClarificationHint.hidden=false}catch{mealClarificationHint.hidden=true}}mealName.addEventListener('change',showSavedMealClarification);mealName.addEventListener('input',()=>{mealClarificationHint.hidden=true});
let lastSelectedMealType='';mealType.addEventListener('change',()=>{lastSelectedMealType=mealType.value});const openMealWithLastType=window.openMeal;window.openMeal=function(){openMealWithLastType();mealType.value=lastSelectedMealType};

voiceOn=false;window.speechSynthesis?.cancel();speechToggle?.remove();
const todayAvatar=document.querySelector('#today .top .avatar');function renderTimeAwareTodayHeader(){const hour=new Date().getHours(),salutation=hour<5?'Доброй ночи':hour<12?'Доброе утро':hour<18?'Добрый день':hour<23?'Добрый вечер':'Доброй ночи',name=profileNameReady?firstName(currentProfile?.name):'';greeting.textContent=`${salutation}${name?`, ${name}`:''}`;if(!todayAvatar)return;todayAvatar.replaceChildren();if(currentAccount.photoUrl){const photo=document.createElement('img');photo.src=currentAccount.photoUrl;photo.alt='Фото профиля';photo.referrerPolicy='no-referrer';photo.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';todayAvatar.append(photo)}else todayAvatar.textContent='🌿'}const renderNutritionWithTimeAwareHeader=window.renderNutrition;window.renderNutrition=function(){renderNutritionWithTimeAwareHeader();renderTimeAwareTodayHeader()};window.renderNutrition();setInterval(renderTimeAwareTodayHeader,60_000);
const historyAddButton=document.querySelector('#diary .top .secondary:last-child');async function renderDietHistory(date,list,status){list.replaceChildren();status.textContent='Загружаю рацион…';try{const entries=await window.nutritionStore?.loadDiaryEntries?.(date)||[];status.textContent=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long'}).format(new Date(`${date}T00:00:00`));if(!entries.length){const empty=document.createElement('p');empty.className='hello';empty.textContent='За этот день записей нет.';list.append(empty);return}const total=entries.reduce((sum,entry)=>sum+safeNumber(entry.calories),0),summary=document.createElement('p');summary.className='hello';summary.textContent=`Всего: ${formatNumber(total)} ккал`;list.append(summary);const groups=new Map();entries.forEach(entry=>{const type=entry.mealType||'Перекус';if(!groups.has(type))groups.set(type,[]);groups.get(type).push(entry)});['Завтрак','Обед','Ужин','Перекус'].forEach(type=>{const items=groups.get(type);if(!items?.length)return;const card=document.createElement('section');card.className='card';const heading=document.createElement('h2');heading.textContent=`${diaryIcons[type]||'🍽️'} ${type}`;card.append(heading);items.forEach(entry=>{const row=document.createElement('div');row.className='entry';const description=document.createElement('div'),title=document.createElement('b'),details=document.createElement('small'),calories=document.createElement('b');title.textContent=entry.title;details.textContent=`${entry.portion||'—'} ${entry.portionUnit||'г'} · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;calories.textContent=`${formatNumber(entry.calories)} ккал`;description.append(title,details);row.append(description,calories);card.append(row)});list.append(card)})}catch{status.textContent='Не удалось загрузить историю.'}}function openDietHistory(){const modal=document.createElement('div');modal.className='modal show';const sheet=document.createElement('section');sheet.className='sheet';const title=document.createElement('h2');title.textContent='История рациона';const label=document.createElement('label');label.className='field';label.textContent='Дата';const input=document.createElement('input');input.type='date';input.max=dataDateKey();input.value=dataDateKey();label.append(input);const status=document.createElement('p');status.className='hello';const list=document.createElement('div');const close=document.createElement('button');close.type='button';close.className='link';close.style.cssText='display:block;margin:14px auto 0';close.textContent='Закрыть';close.onclick=()=>modal.remove();input.onchange=()=>renderDietHistory(input.value,list,status);sheet.append(title,label,status,list,close);modal.append(sheet);document.body.append(modal);renderDietHistory(input.value,list,status);input.focus()}if(historyAddButton&&!document.getElementById('dietHistoryButton')){const historyButton=document.createElement('button');historyButton.id='dietHistoryButton';historyButton.type='button';historyButton.className='secondary';historyButton.style.cssText='margin-left:6px;white-space:nowrap';historyButton.textContent='История';historyButton.onclick=openDietHistory;historyAddButton.before(historyButton)}
document.getElementById('dietHistoryButton')?.remove();const diaryTitle=document.querySelector('#diary .top h1'),diaryTitleWrap=diaryTitle?.parentElement,diaryCalendarInput=document.createElement('input');let selectedDiaryDate=dataDateKey();function diaryDateTitle(date){if(date===dataDateKey())return 'Сегодня';if(date===dateKeyFor('tomorrow'))return 'Завтра';return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(new Date(`${date}T00:00:00`))}async function renderDiaryForDate(date){selectedDiaryDate=date;diaryTitle.textContent=diaryDateTitle(date);if(date===dataDateKey()){await loadDiary();return}mealList.replaceChildren();const hint=document.createElement('p');hint.className='hello';hint.textContent='Просмотр сохранённого рациона';mealList.append(hint);try{const entries=await window.nutritionStore?.loadDiaryEntries?.(date)||[];if(!entries.length){const empty=document.createElement('section');empty.className='card';empty.textContent='За этот день записей нет.';mealList.append(empty);return}const total=entries.reduce((sum,entry)=>sum+safeNumber(entry.calories),0),summary=document.createElement('p');summary.className='hello';summary.textContent=`Всего: ${formatNumber(total)} ккал`;mealList.append(summary);const groups=new Map();entries.forEach(entry=>{const type=entry.mealType||'Перекус';if(!groups.has(type))groups.set(type,[]);groups.get(type).push(entry)});['Завтрак','Обед','Ужин','Перекус'].forEach(type=>{const items=groups.get(type);if(!items?.length)return;const card=document.createElement('section');card.className='card';const heading=document.createElement('h2');heading.textContent=`${diaryIcons[type]||'🍽️'} ${type}`;card.append(heading);items.forEach(entry=>{const row=document.createElement('div');row.className='entry';const description=document.createElement('div'),title=document.createElement('b'),details=document.createElement('small'),calories=document.createElement('b');title.textContent=entry.title;details.textContent=`${entry.portion||'—'} ${entry.portionUnit||'г'} · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;calories.textContent=`${formatNumber(safeNumber(entry.calories))} ккал`;description.append(title,details);row.append(description,calories);card.append(row)});mealList.append(card)})}catch{toast('Не удалось загрузить рацион. Попробуйте ещё раз.')}}if(diaryTitle&&diaryTitleWrap&&!document.getElementById('diaryCalendarButton')){diaryTitle.style.display='inline-block';diaryCalendarInput.id='diaryCalendarInput';diaryCalendarInput.type='date';diaryCalendarInput.max=dateKeyFor('tomorrow');diaryCalendarInput.value=dataDateKey();diaryCalendarInput.style.cssText='position:absolute;opacity:0;pointer-events:none;width:1px;height:1px';diaryCalendarInput.onchange=()=>renderDiaryForDate(diaryCalendarInput.value);const calendarButton=document.createElement('button');calendarButton.id='diaryCalendarButton';calendarButton.type='button';calendarButton.className='link';calendarButton.style.cssText='margin-left:8px;font-size:20px;vertical-align:middle';calendarButton.textContent='📅';calendarButton.setAttribute('aria-label','Выбрать дату рациона');calendarButton.onclick=()=>{if(diaryCalendarInput.showPicker)diaryCalendarInput.showPicker();else diaryCalendarInput.click()};diaryTitleWrap.append(calendarButton,diaryCalendarInput)}window.addEventListener('nutrition-auth-changed',()=>renderDiaryForDate(selectedDiaryDate));window.addEventListener('nutritionstore-ready',()=>renderDiaryForDate(selectedDiaryDate));
Array.from(document.querySelectorAll('#diary .top .secondary')).find(button=>button.textContent.trim()==='✦ С ИИ')?.remove();
Array.from(document.querySelectorAll('#diary .hello')).find(element=>element.textContent.includes('Добавьте с ИИ:'))?.remove();

// Group entries in native disclosure widgets so each meal can be collapsed without
// hiding its calorie subtotal.  Keeping the entries in a separate body also makes
// deletion and subtotal recalculation independent from the heading markup.
function updateMealGroupSummary(card){
  if(!card)return;
  const total=Array.from(card.querySelectorAll('.entry')).reduce((sum,row)=>sum+safeNumber(row.dataset.calories),0);
  const totalElement=card.querySelector('.meal-group-total');
  if(totalElement)totalElement.textContent=`${formatNumber(total)} ккал`;
}

function createMealGroup(type){
  const card=document.createElement('details');
  card.className='card meal-group';
  card.dataset.mealType=type;
  card.open=true;
  const summary=document.createElement('summary');
  const title=document.createElement('span');
  title.className='meal-group-title';
  title.textContent=`${diaryIcons[type]||'🍽️'} ${type}`;
  const total=document.createElement('b');
  total.className='meal-group-total';
  total.textContent='0 ккал';
  summary.append(title,total);
  const body=document.createElement('div');
  body.className='meal-group-body';
  card.append(summary,body);
  return card;
}

function createDiaryEntryRow(entry,{deletable=false}={}){
  const item=document.createElement('div');
  item.className='entry';
  item.dataset.entryId=entry.id||'';
  item.dataset.calories=safeNumber(entry.calories);
  if(deletable)item.style.cssText='position:relative;padding-right:36px';
  const description=document.createElement('div');
  const title=document.createElement('b');
  title.textContent=entry.title;
  const details=document.createElement('small');
  details.textContent=`${entry.portion||'—'} ${entry.portionUnit||'г'} · Б ${safeNumber(entry.protein)} · Ж ${safeNumber(entry.fat)} · У ${safeNumber(entry.carbs)}`;
  const calories=document.createElement('b');
  calories.textContent=`${formatNumber(safeNumber(entry.calories))} ккал`;
  description.append(title,details);
  item.append(description,calories);
  if(deletable){
    const remove=document.createElement('button');
    remove.type='button';remove.className='link';remove.textContent='×';
    remove.title=`Удалить ${entry.title}`;remove.setAttribute('aria-label',`Удалить ${entry.title}`);
    remove.style.cssText='position:absolute;right:0;top:8px;margin:0;padding:0 4px;color:#b44747;font-size:22px;line-height:1;font-weight:700';
    remove.onclick=event=>{event.preventDefault();event.stopPropagation();window.deleteDiaryEntry(entry.id,item)};
    item.append(remove);
  }
  return item;
}

function appendEntriesByMeal(list,entries,{deletable=false}={}){
  const groups=new Map();
  entries.forEach(entry=>{const type=entry.mealType||'Перекус';if(!groups.has(type))groups.set(type,[]);groups.get(type).push(entry)});
  mealTypeOrder.forEach(type=>{
    const items=groups.get(type);if(!items?.length)return;
    const card=createMealGroup(type),body=card.querySelector('.meal-group-body');
    items.forEach(entry=>body.append(createDiaryEntryRow(entry,{deletable})));
    updateMealGroupSummary(card);
    list.append(card);
  });
}

window.addDiaryEntryToView=function(entry){
  if(entry.date!==dataDateKey())return;
  entry.id||=crypto.randomUUID();
  todayNutrition.calories+=safeNumber(entry.calories);todayNutrition.protein+=safeNumber(entry.protein);
  todayNutrition.fat+=safeNumber(entry.fat);todayNutrition.carbs+=safeNumber(entry.carbs);renderNutrition();
  const empty=mealList.querySelector('.hello');if(empty?.closest('.card'))empty.closest('.card').remove();
  const type=entry.mealType||'Перекус';
  let card=mealList.querySelector(`[data-meal-type="${type}"]`);
  if(!card){
    card=createMealGroup(type);
    const rank=mealTypeRank(type);
    const next=Array.from(mealList.querySelectorAll('[data-meal-type]')).find(existing=>mealTypeRank(existing.dataset.mealType)>rank);
    mealList.insertBefore(card,next||null);
  }
  card.querySelector('.meal-group-body').append(createDiaryEntryRow(entry,{deletable:true}));
  updateMealGroupSummary(card);
};

window.deleteDiaryEntry=async function(id,item){
  const row=item||mealList.querySelector(`[data-entry-id="${id}"]`);
  if(!row){toast('Не удалось определить запись для удаления');return}
  const values={calories:safeNumber(row.dataset.calories),protein:Number((row.textContent.match(/Б\s*([\d.,]+)/)||[,0])[1].replace(',','.')),fat:Number((row.textContent.match(/Ж\s*([\d.,]+)/)||[,0])[1].replace(',','.')),carbs:Number((row.textContent.match(/У\s*([\d.,]+)/)||[,0])[1].replace(',','.'))};
  const card=row.closest('[data-meal-type]');row.remove();
  if(card&&!card.querySelector('.entry'))card.remove();else updateMealGroupSummary(card);
  todayNutrition.calories=Math.max(0,todayNutrition.calories-values.calories);todayNutrition.protein=Math.max(0,todayNutrition.protein-safeNumber(values.protein));todayNutrition.fat=Math.max(0,todayNutrition.fat-safeNumber(values.fat));todayNutrition.carbs=Math.max(0,todayNutrition.carbs-safeNumber(values.carbs));renderNutrition();
  try{await window.nutritionStore?.deleteDiaryEntry?.(id);toast('Запись удалена из дневника')}catch{await loadDiary();toast('Не удалось сохранить удаление. Попробуйте ещё раз.')}
};

async function renderDiaryForDate(date){
  selectedDiaryDate=date;diaryTitle.textContent=diaryDateTitle(date);
  if(date===dataDateKey()){await loadDiary();return}
  mealList.replaceChildren();
  const hint=document.createElement('p');hint.className='hello';hint.textContent='Просмотр сохранённого рациона';mealList.append(hint);
  try{
    const entries=await window.nutritionStore?.loadDiaryEntries?.(date)||[];
    if(!entries.length){const empty=document.createElement('section');empty.className='card';empty.textContent='За этот день записей нет.';mealList.append(empty);return}
    const total=entries.reduce((sum,entry)=>sum+safeNumber(entry.calories),0),summary=document.createElement('p');summary.className='hello';summary.textContent=`Всего: ${formatNumber(total)} ккал`;mealList.append(summary);
    appendEntriesByMeal(mealList,entries);
  }catch{toast('Не удалось загрузить рацион. Попробуйте ещё раз.')}
}

async function renderDietHistory(date,list,status){
  list.replaceChildren();status.textContent='Загружаю рацион…';
  try{
    const entries=await window.nutritionStore?.loadDiaryEntries?.(date)||[];
    status.textContent=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long'}).format(new Date(`${date}T00:00:00`));
    if(!entries.length){const empty=document.createElement('p');empty.className='hello';empty.textContent='За этот день записей нет.';list.append(empty);return}
    const total=entries.reduce((sum,entry)=>sum+safeNumber(entry.calories),0),summary=document.createElement('p');summary.className='hello';summary.textContent=`Всего: ${formatNumber(total)} ккал`;list.append(summary);
    appendEntriesByMeal(list,entries);
  }catch{status.textContent='Не удалось загрузить историю.'}
}

function clearMealEstimateError(input){
  document.getElementById(`${input.id}Error`)?.remove();
  input.setCustomValidity('');
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  if(input.id==='mealName')input.placeholder='Например, салат с курицей';
}
function showMealEstimateHint(input,message){
  input.setCustomValidity(message);
  input.reportValidity();
}
function validateMealEstimate(){
  const name=document.getElementById('mealName'),portion=document.getElementById('portion');
  [name,portion].forEach(clearMealEstimateError);
  const amount=Number(portion.value);
  const input=!name.value.trim()?name:(!Number.isFinite(amount)||amount<=0?portion:null);
  if(!input)return true;
  const errorMessage=input===name?'Введите название блюда.':'Укажите порцию: вес в граммах или количество штук, больше нуля.';
  if(input===name){
    const error=document.createElement('span');
    error.id=`${input.id}Error`;
    error.className='field-error sr-only';
    error.setAttribute('role','alert');
    error.textContent=errorMessage;
    input.placeholder=error.textContent;
    input.after(error);
    input.setAttribute('aria-describedby',error.id);
  }else{
    showMealEstimateHint(input,errorMessage);
  }
  input.setAttribute('aria-invalid','true');
  input.focus();
  input.scrollIntoView({block:'nearest'});
  return false;
}
['mealName','portion'].forEach(id=>{
  const input=document.getElementById(id);
  input.addEventListener('input',()=>clearMealEstimateError(input));
});
portion.addEventListener('invalid',()=>{
  if(!Number.isFinite(Number(portion.value))||Number(portion.value)<=0)portion.setCustomValidity('Укажите порцию: вес в граммах или количество штук, больше нуля.');
});
document.querySelector('#modal form').addEventListener('reset',()=>{
  ['mealName','portion'].forEach(id=>clearMealEstimateError(document.getElementById(id)));
});
// Follow the visible area when the on-screen keyboard reduces the viewport.
// Preserve the browser's normal pinch-to-zoom behavior.
if(window.visualViewport){
  const viewport=window.visualViewport;
  const updateFormViewport=()=>{
    if(Math.abs(viewport.scale-1)>0.01)return;
    document.documentElement.style.setProperty('--form-viewport-height',`${viewport.height}px`);
    document.documentElement.style.setProperty('--form-viewport-top',`${viewport.offsetTop}px`);
  };
  viewport.addEventListener('resize',updateFormViewport);
  viewport.addEventListener('scroll',updateFormViewport);
  updateFormViewport();
}

let weightHistory=[];
const weightFormat=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1});
const weightDate=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(`${value}T00:00:00`));
function renderWeightProgress(){
  const chart=document.getElementById('weightChart'),change=document.getElementById('weightChange'),summary=document.getElementById('weightSummary'),percent=document.getElementById('weightPercent'),goal=document.getElementById('weightGoalText');
  const entries=[...weightHistory].filter(entry=>entry.date&&Number.isFinite(Number(entry.weight))).sort((a,b)=>a.date.localeCompare(b.date));
  const target=Number(currentProfile?.targetWeight);
  goal.textContent=Number.isFinite(target)&&target>0?`Цель: ${weightFormat(target)} кг`:'Цель: не указана';
  chart.replaceChildren();
  if(!entries.length){change.textContent='Нет данных';summary.textContent='Добавьте первую запись веса';percent.textContent='—';const hint=document.createElement('p');hint.className='hello';hint.textContent='Нет записей за последние 30 дней.';chart.append(hint);return}
  const since=new Date();since.setDate(since.getDate()-29);const recent=entries.filter(entry=>new Date(`${entry.date}T00:00:00`)>=since).slice(-7);
  const monthEntries=entries.filter(entry=>new Date(`${entry.date}T00:00:00`)>=since),first=monthEntries[0]||entries.at(-1),last=monthEntries.at(-1)||entries.at(-1),delta=Number(last.weight)-Number(first.weight),deltaText=`${delta>0?'+':''}${weightFormat(delta)} кг`;
  change.textContent=monthEntries.length>1?deltaText:`${weightFormat(last.weight)} кг`;
  summary.textContent=monthEntries.length>1?`Старт: ${weightFormat(first.weight)} кг · Сейчас: ${weightFormat(last.weight)} кг`:`Текущий вес: ${weightFormat(last.weight)} кг`;
  percent.textContent=monthEntries.length>1&&Number(first.weight)?`${delta>0?'+':''}${weightFormat(delta/Number(first.weight)*100)}%`:'—';
  const values=recent.map(entry=>Number(entry.weight)),min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  recent.forEach(entry=>{const bar=document.createElement('i');bar.dataset.day=weightDate(entry.date);bar.dataset.weight=weightFormat(entry.weight);bar.style.height=`${values.length===1?55:25+(Number(entry.weight)-min)/range*65}%`;bar.title=`${weightDate(entry.date)}: ${weightFormat(entry.weight)} кг`;chart.append(bar)});
}
async function loadWeightProgress(){
  if(!window.nutritionStore?.loadWeightEntries)return;
  try{weightHistory=await window.nutritionStore.loadWeightEntries();renderWeightProgress()}catch{weightHistory=[];renderWeightProgress();toast('Не удалось загрузить прогресс веса.')}
}
window.addWeight=function(){
  const modal=document.createElement('div');modal.className='modal show';modal.innerHTML='<form class="sheet"><h2>Записать вес</h2><label class="field">Дата<input type="date" required></label><label class="field">Вес, кг<input type="number" min="20" max="500" step="0.1" required></label><button class="primary">Сохранить</button><button class="link" type="button" style="display:block;margin:14px auto 0">Отмена</button></form>';
  const form=modal.querySelector('form'),[dateInput,weightInput]=form.querySelectorAll('input');dateInput.value=dataDateKey();weightInput.value=Number(currentProfile?.weight)||'';
  form.onsubmit=async event=>{event.preventDefault();const weight=Number(weightInput.value);if(!Number.isFinite(weight)||weight<20||weight>500){weightInput.focus();return}const entry={date:dateInput.value,weight};try{await window.nutritionStore?.saveWeightEntry?.(entry);weightHistory=weightHistory.filter(item=>item.date!==entry.date).concat(entry);if(entry.date===dataDateKey()&&currentProfile){currentProfile={...currentProfile,weight};renderProfile();window.renderNutrition?.()}renderWeightProgress();modal.remove();toast('Вес сохранён')}catch{toast('Не удалось сохранить вес. Попробуйте ещё раз.')}};
  form.querySelector('button[type="button"]').onclick=()=>modal.remove();document.body.append(modal);weightInput.focus();
};
document.querySelector('.nav[data-target="progress"]')?.addEventListener('click',loadWeightProgress);
window.addEventListener('nutritionstore-ready',loadWeightProgress);
window.addEventListener('nutrition-auth-changed',loadWeightProgress);
renderWeightProgress();

const manualPhotoInput=document.createElement('input');manualPhotoInput.id='manualMealPhoto';manualPhotoInput.type='file';manualPhotoInput.accept='image/jpeg,image/png,image/webp';manualPhotoInput.capture='environment';manualPhotoInput.style.display='none';const manualPhotoButton=document.createElement('button');manualPhotoButton.type='button';manualPhotoButton.className='secondary';manualPhotoButton.title='Распознать блюдо по фото';manualPhotoButton.setAttribute('aria-label','Распознать блюдо по фото');manualPhotoButton.textContent='📷';manualPhotoButton.style.cssText='align-self:center;width:42px;height:42px;padding:0;display:grid;place-items:center;line-height:1';const manualPhotoRow=mealNameField?.parentElement;if(manualPhotoRow&&!document.getElementById('manualMealPhoto')){manualPhotoRow.insertBefore(manualPhotoButton,portionField);document.body.append(manualPhotoInput)}manualPhotoButton.onclick=()=>{const useCamera=window.confirm('Снять новое фото?\n\nОК — камера\nОтмена — выбрать файл');if(useCamera)manualPhotoInput.setAttribute('capture','environment');else manualPhotoInput.removeAttribute('capture');manualPhotoInput.click()};async function recognizeManualMealPhoto(file){if(!file)return;if(file.size>4*1024*1024){toast('Фото должно быть не больше 4 МБ');return}const token=await getAiToken();if(token===undefined)return;if(!token){window.showAuthRequiredDialog();return}manualPhotoButton.disabled=true;manualPhotoButton.textContent='…';try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)}),response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:'Распознай блюдо на фотографии. Верни один наиболее заметный продукт или блюдо с ориентировочными калориями, белками, жирами, углеводами и весом порции в граммах. Не сохраняй ничего.',image:{dataUrl,mimeType:file.type}})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка сервиса');const estimate=Array.isArray(data.proposedProducts)?data.proposedProducts[0]:data.proposedMeal;if(!estimate?.title||!Number.isFinite(Number(estimate.calories)))throw new Error('ИИ не смог распознать блюдо');mealName.value=estimate.title;portion.value=Math.round(Number(estimate.portion)||0)||'';calories.value=Math.round(Number(estimate.calories));protein.value=Number(estimate.protein||0);fat.value=Number(estimate.fat||0);carbs.value=Number(estimate.carbs||0);toast('Данные заполнены по фото — проверьте их перед сохранением')}catch(error){toast(`Не удалось распознать фото: ${error.message}`)}finally{manualPhotoInput.value='';manualPhotoButton.textContent='📷';manualPhotoButton.disabled=false}}manualPhotoInput.addEventListener('change',()=>recognizeManualMealPhoto(manualPhotoInput.files?.[0]));

let aiServiceError='',aiTokenError='',aiRequests=0;
function renderAiAvailability(){
  const auth=window.getFirebaseAuthStatus?.();
  const reason=navigator.onLine===false?'Нет интернета — ИИ недоступен.':!auth||auth.state==='loading'?'Подключаем аккаунт — ИИ пока недоступен.':auth.state==='error'?'Сервис входа недоступен. Повторите подключение в профиле.':!auth.signedIn?'Для ИИ нужен вход в аккаунт.':aiTokenError||aiServiceError;
  const buttons=[document.getElementById('calculateMealButton'),document.querySelector('#assistant .send'),document.querySelector('[aria-label="Распознать блюдо по фото"]')];
  for(const button of buttons){
    if(!button)continue;
    button.dataset.readyTitle??=button.title;
    button.classList.toggle('ai-unavailable',Boolean(reason)||aiRequests>0);
    button.title=reason||button.dataset.readyTitle;
  }
  const send=document.querySelector('#assistant .send');if(send)send.disabled=aiRequests>0;
  for(const [id,anchor] of [['aiAvailabilityStatus',document.querySelector('#assistant .ask')],['aiMealAvailabilityStatus',document.getElementById('calculateMealButton')]]){
    if(!anchor)continue;
    let hint=document.getElementById(id);
    if(!hint){hint=document.createElement('p');hint.id=id;hint.className='status';hint.setAttribute('role','status');anchor.after(hint)}
    hint.textContent=reason;hint.hidden=!reason;
  }
}
window.setAiTokenError=message=>{aiTokenError=message;renderAiAvailability()};
function logAiResponse(response){
  response.clone().text().then(body=>{
    let payload=body;
    try{payload=JSON.parse(body)}catch{}
    console.info('[ИИ] Ответ Worker', {status:response.status,ok:response.ok,payload});
  }).catch(()=>console.info('[ИИ] Получен ответ Worker', {status:response.status,ok:response.ok}));
}
async function requestAiAdvice(options){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  aiRequests++;renderAiAvailability();
  try{
    const response=await fetch(AI_ENDPOINT,{...options,signal:controller.signal});
    logAiResponse(response);
    if(response.ok)aiServiceError='';
    else if(response.status===401||response.status===403)aiServiceError='Не удалось подтвердить доступ к ИИ. Повторите вход в профиле.';
    else if(response.status===429||response.status>=500)aiServiceError='ИИ временно недоступен. Можно повторить запрос позже.';
    return response;
  }catch(error){
    aiServiceError=error.name==='AbortError'?'ИИ не ответил вовремя. Проверьте соединение и повторите запрос.':'Не удалось подключиться к ИИ. Проверьте интернет и повторите запрос.';
    throw new Error(aiServiceError);
  }finally{clearTimeout(timer);aiRequests--;renderAiAvailability()}
}
window.addEventListener('nutrition-auth-status',renderAiAvailability);
window.addEventListener('nutrition-auth-changed',()=>{aiTokenError='';aiServiceError='';renderAiAvailability()});
window.addEventListener('offline',renderAiAvailability);
window.addEventListener('online',()=>{aiTokenError='';renderAiAvailability()});
renderAiAvailability();

const mealFormLayout=document.querySelector('#modal form');
const mealCaloriesField=document.getElementById('calories')?.closest('.field');
// Добавляем обработчик для фото порции
window.handleMealPhoto = async (file) => {
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    
    // Отправляем фото в ИИ для распознавания порции
    const token = await getAiToken();
    if (token === undefined) return;
    if (!token) {
      window.showAuthRequiredDialog();
      return;
    }
    
    try {
      const response = await requestAiAdvice({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          message: "Определи порцию продукта на фото в граммах. Верни только число без единиц измерения.",
          image: {
            dataUrl: dataUrl,
            mimeType: file.type
          }
        })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка сервиса');
      
      // Извлекаем число из ответа ИИ
      const number = data.advice.match(/\d+/);
      if (number) {
        portionInput.value = number[0];
        portionInput.dispatchEvent(new Event('input', { bubbles: true }));
        toast('Порция распознана');
      } else {
        toast('Не удалось распознать порцию');
      }
    } catch (error) {
      toast(`Ошибка распознавания: ${error.message}`);
    }
  };
  reader.readAsDataURL(file);
};
const mealProteinField=document.getElementById('protein')?.closest('.field');
const mealFatField=document.getElementById('fat')?.closest('.field');
const mealCarbsField=document.getElementById('carbs')?.closest('.field');
if(mealFormLayout&&mealNameField&&portionField&&mealCaloriesField&&mealProteinField&&mealFatField&&mealCarbsField){
  const oldRows=[...new Set([mealNameField,portionField,mealCaloriesField,mealProteinField,mealFatField,mealCarbsField].map(field=>field.closest('.row')).filter(Boolean))];
  oldRows.forEach(row=>row.remove());
  const layoutAnchor=document.getElementById('nutritionPrecisionHint')||document.getElementById('calculateMealButton')||mealFormLayout.querySelector('.primary');
  const mealDataRow=document.createElement('div');
  mealDataRow.className='row meal-data-row';
  mealDataRow.append(portionField,mealCaloriesField);
  const mealMacrosRow=document.createElement('div');
  mealMacrosRow.className='row meal-macros-row';
  mealMacrosRow.append(mealProteinField,mealFatField,mealCarbsField);
  mealFormLayout.insertBefore(mealNameField,layoutAnchor);
  mealFormLayout.insertBefore(mealDataRow,layoutAnchor);
  mealFormLayout.insertBefore(mealMacrosRow,layoutAnchor);
}

const adviceForm=document.querySelector('.ask');
const adviceQuestion=document.getElementById('question');
const advicePhotoButton=document.getElementById('advicePhotoButton');
const adviceMicButton=document.getElementById('micButton');
const adviceSendButton=adviceForm?.querySelector('.send');
if(adviceForm&&adviceQuestion&&advicePhotoButton&&adviceMicButton&&adviceSendButton){
  const adviceControl=document.createElement('div');
  adviceControl.className='ask-control';
  const adviceActions=document.createElement('span');
  adviceActions.className='ask-actions';
  advicePhotoButton.classList.add('ask-action','ask-photo-action');
  adviceMicButton.classList.add('ask-action','ask-mic-action');
  adviceSendButton.classList.add('ask-action','ask-send-action');
  adviceForm.append(adviceControl);
  adviceControl.append(adviceQuestion,adviceActions);
  adviceActions.append(advicePhotoButton,adviceMicButton,adviceSendButton);
}

const mealNameControl=document.createElement('div');
mealNameControl.className='meal-name-control';
const mealNameActions=document.createElement('span');
mealNameActions.className='meal-name-actions';
const mealNameInput=document.getElementById('mealName');
if(mealNameInput&&manualPhotoButton){
  mealNameInput.parentElement.append(mealNameControl);
  mealNameControl.append(mealNameInput,mealNameActions);
  manualPhotoButton.classList.add('meal-name-action');
  manualPhotoButton.classList.add('meal-photo-action');
  manualPhotoButton.style.cssText='';
  mealNameActions.append(manualPhotoButton);
  const mealVoiceButton=document.createElement('button');
  mealVoiceButton.type='button';
  mealVoiceButton.className='secondary meal-name-action';
  mealVoiceButton.textContent='🎙';
  mealVoiceButton.title='Ввести название голосом';
  mealVoiceButton.setAttribute('aria-label','Ввести название блюда голосом');
  mealNameActions.append(mealVoiceButton);
  if(nutritionCalculateButton){
    nutritionCalculateButton.className='secondary meal-name-action meal-calculate-action';
    nutritionCalculateButton.style.cssText='';
    nutritionCalculateButton.textContent='✦';
    nutritionCalculateButton.title='Рассчитать БЖУ с ИИ';
    nutritionCalculateButton.setAttribute('aria-label','Рассчитать БЖУ с ИИ');
    mealNameActions.append(nutritionCalculateButton);
  }
  let mealRecognition=null;
  mealVoiceButton.onclick=()=>{
    if(!Recognition){toast('Голосовой ввод не поддерживается этим браузером.');return}
    if(mealRecognition){mealRecognition.stop();return}
    mealRecognition=new Recognition();
    mealRecognition.lang='ru-RU';
    mealRecognition.interimResults=true;
    mealRecognition.continuous=false;
    mealVoiceButton.classList.add('is-listening');
    mealVoiceButton.textContent='■';
    mealVoiceButton.setAttribute('aria-label','Остановить голосовой ввод');
    mealRecognition.onresult=event=>{mealNameInput.value=Array.from(event.results).map(result=>result[0].transcript).join('')};
    mealRecognition.onerror=()=>toast('Не удалось распознать название блюда.');
    mealRecognition.onend=()=>{mealRecognition=null;mealVoiceButton.classList.remove('is-listening');mealVoiceButton.textContent='🎙';mealVoiceButton.setAttribute('aria-label','Ввести название блюда голосом')};
    mealRecognition.start();
  };
}

function showAiResponseDiagnostic(rawResponse){
  const debug=document.getElementById('aiDebug');
  if(!debug||typeof rawResponse!=='string'||!rawResponse)return;
  let panel=document.getElementById('aiResponseDiagnostic');
  if(!panel){
    panel=document.createElement('details');panel.id='aiResponseDiagnostic';panel.className='ai-response-diagnostic';
    const summary=document.createElement('summary');summary.textContent='Показать ответ ИИ для диагностики';
    const pre=document.createElement('pre');const copy=document.createElement('button');copy.type='button';copy.className='link';copy.textContent='Скопировать';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(pre.textContent);copy.textContent='Скопировано'}catch{copy.textContent='Не удалось скопировать'}};
    panel.append(summary,pre,copy);debug.after(panel);
  }
  panel.querySelector('pre').textContent=rawResponse;panel.open=true;
}

window.askAI=async function(event){
  event.preventDefault();const text=question.value.trim();if(!text)return;
  const token=await getAiToken();if(token===undefined)return;if(!token){chatStatus.textContent='Войдите в аккаунт в профиле, чтобы воспользоваться ИИ.';show('profile');return}
  const before=chatlog.children.length;document.getElementById('aiResponseDiagnostic')?.remove();chatlog.insertAdjacentHTML('beforeend','<div class="bubble user"></div>');chatlog.lastElementChild.textContent=text;question.value='';chatStatus.textContent='Формирую ответ…';setAiDebug('запрос отправлен');
  try{
    const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:text,image:selectedPhoto})});
    const body=await response.text();let data;try{data=JSON.parse(body)}catch{throw new Error('Worker вернул ответ не в JSON-формате')}
    if(!response.ok){setAiDebug(`Worker ответил HTTP ${response.status}`);showAiResponseDiagnostic(data.debugResponse);throw new Error(data.error||'Ошибка сервиса')}
    if(typeof data.advice!=='string')throw new Error('Worker вернул неполный ответ');
    setAiDebug('Worker ответил успешно');chatlog.insertAdjacentHTML('beforeend','<div class="bubble"></div>');chatlog.lastElementChild.textContent=data.advice;chatStatus.textContent='Ответ носит справочный характер.';
    if(data.proposedProducts)await showProductProposals(data.proposedProducts);if(data.proposedMeal)showMealProposal(data.proposedMeal);removePhoto();
    if(voiceOn&&chatlog.children.length>before&&'speechSynthesis'in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(data.advice);utterance.lang='ru-RU';speechSynthesis.speak(utterance)}
  }catch(error){const status=document.getElementById('aiDebug')?.textContent||'';if(!status.includes('HTTP'))setAiDebug('ошибка запроса');chatStatus.textContent='Не удалось получить ответ: '+error.message}
};

let recognizedManualMealEstimate=null;

function showPhotoRecognitionDialog(message,title='Результат распознавания'){
  document.getElementById('photoRecognitionDialog')?.remove();
  const dialog=document.createElement('div');
  dialog.id='photoRecognitionDialog';
  dialog.className='modal show';
  const match=String(message||'').trim().match(/^([^\r\n]+)\r?\nБ:\s*([\d.,]+)\s*г\s*·\s*Ж:\s*([\d.,]+)\s*г\s*·\s*У:\s*([\d.,]+)\s*г$/);
  dialog.innerHTML='<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="photoRecognitionTitle"><h2 id="photoRecognitionTitle"></h2><p class="hello" style="white-space:pre-line"></p><div class="photo-add-controls" hidden><label class="field">Вес, г<input type="number" min="1" step="1" value="100"></label><label class="field">Приём пищи<select><option>Завтрак</option><option>Обед</option><option>Ужин</option><option selected>Перекус</option></select></label><label class="field">Когда добавить<select><option value="today">Сегодня</option><option value="tomorrow">Завтра</option></select></label><button class="primary" type="button">Добавить</button></div><button class="link" type="button" style="display:block;margin:14px auto 0">Закрыть</button></section>';
  dialog.querySelector('h2').textContent=title;
  dialog.querySelector('p').textContent=message;
  const close=()=>dialog.remove();
  const [controls,weight,mealType,date,add,closeButton]=[dialog.querySelector('.photo-add-controls'),...dialog.querySelectorAll('input,select,button')];
  if(match){controls.hidden=false;const number=value=>Number(String(value).replace(',','.'));const base={protein:number(match[2]),fat:number(match[3]),carbs:number(match[4])};const values=()=>{const ratio=Math.max(Number(weight.value)||0,0)/100;return{protein:Number((base.protein*ratio).toFixed(1)),fat:Number((base.fat*ratio).toFixed(1)),carbs:Number((base.carbs*ratio).toFixed(1))}};const render=()=>{const value=values();dialog.querySelector('p').textContent=`${match[1].trim()}\nБ: ${value.protein} г · Ж: ${value.fat} г · У: ${value.carbs} г`};weight.oninput=render;render();add.onclick=()=>{const value=values();if(!Number.isFinite(Number(weight.value))||Number(weight.value)<=0){weight.focus();return}const entry={id:crypto.randomUUID(),date:dateKeyFor(date.value),mealType:mealType.value,title:match[1].trim(),portion:Number(weight.value),calories:Math.round(value.protein*4+value.fat*9+value.carbs*4),...value,source:'photo-ai-confirmed'};addDiaryEntryToView(entry);persistUserData('saveDiaryEntry',entry);close();toast(`Блюдо добавлено на ${date.value==='today'?'сегодня':'завтра'}`)}}
  closeButton.onclick=close;
  dialog.onkeydown=event=>{if(event.key==='Escape')close()};
  document.body.append(dialog);
  dialog.querySelector('button').focus();
}

function fillRecognizedMealNutrition(){
  if(!recognizedManualMealEstimate)return;
  const amount=Number(portion.value);
  if(!Number.isFinite(amount)||amount<=0){calories.value='';protein.value='';fat.value='';carbs.value='';return}
  const ratio=amount/recognizedManualMealEstimate.portion;
  calories.value=Math.round(recognizedManualMealEstimate.calories*ratio);
  protein.value=Number((recognizedManualMealEstimate.protein*ratio).toFixed(1));
  fat.value=Number((recognizedManualMealEstimate.fat*ratio).toFixed(1));
  carbs.value=Number((recognizedManualMealEstimate.carbs*ratio).toFixed(1));
}

portion.addEventListener('input',fillRecognizedMealNutrition);
mealName.addEventListener('input',()=>{recognizedManualMealEstimate=null});

async function recognizeManualMealPhoto(file){
  if(!file)return;
  if(file.size>4*1024*1024){toast('Фото должно быть не больше 4 МБ');return}
  const token=await getAiToken();
  if(token===undefined)return;
  if(!token){window.showAuthRequiredDialog();return}
  manualPhotoButton.disabled=true;
  manualPhotoButton.textContent='…';
  try{
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
    const response=await requestAiAdvice({method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:'Распознай блюдо на фотографии. Верни один наиболее заметный продукт или блюдо с ориентировочными калориями, белками, жирами, углеводами и весом порции в граммах. Не сохраняй ничего.',image:{dataUrl,mimeType:file.type}})});
    const data=await response.json();
    if(!response.ok){if(typeof data.debugResponse==='string'&&data.debugResponse){showPhotoRecognitionDialog(data.debugResponse,'Ответ ИИ');return}throw new Error(data.error||'Ошибка сервиса')}
    const answer=String(data.advice||'').trim();
    if(!answer)throw new Error('ИИ не вернул результат распознавания');
    const normalized=answer.toLowerCase();
    const isNotFood=normalized==='это не еда.'||normalized==='это не еда';
    const title=isNotFood||normalized==='не удалось распознать блюдо.'||normalized==='не удалось распознать блюдо'?'Распознавание фото':'Результат распознавания';
    showPhotoRecognitionDialog(isNotFood?'🪨 Это не еда.':answer,title);
  }catch(error){toast(`Не удалось распознать фото: ${error.message}`)}
  finally{manualPhotoInput.value='';manualPhotoButton.textContent='📷';manualPhotoButton.disabled=false}
}

function showManualPhotoDiagnostic(rawResponse){
  if(typeof rawResponse!=='string'||!rawResponse)return;
  let panel=document.getElementById('manualPhotoDiagnostic');
  if(!panel){
    panel=document.createElement('details');
    panel.id='manualPhotoDiagnostic';
    panel.className='ai-response-diagnostic';
    const summary=document.createElement('summary');
    summary.textContent='Показать ответ ИИ для диагностики';
    const content=document.createElement('pre');
    const copy=document.createElement('button');
    copy.type='button';copy.className='link';copy.textContent='Скопировать';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(content.textContent);copy.textContent='Скопировано'}catch{copy.textContent='Не удалось скопировать'}};
    panel.append(summary,content,copy);
    mealNameControl.after(panel);
  }
  panel.querySelector('pre').textContent=rawResponse;
  panel.open=true;
}

// The product list belongs to the current user. It is loaded only when the
// meal field receives focus, then kept in memory for the current session.
const mealSuggestions=document.createElement('datalist');
mealSuggestions.id='mealNameSuggestions';
document.body.append(mealSuggestions);
mealNameInput?.setAttribute('list',mealSuggestions.id);
let savedMealProducts=[];
let savedMealProductsUid='';
let savedMealProductsLoading=null;
let savedMealEstimate=null;

function renderMealSuggestions(products){
  mealSuggestions.replaceChildren();
  [...new Map(products.map(product=>[String(product.title).trim().toLocaleLowerCase('ru-RU'),product])).values()]
    .sort((left,right)=>left.title.localeCompare(right.title,'ru'))
    .forEach(product=>{const option=document.createElement('option');option.value=product.title.trim();mealSuggestions.append(option)});
}

async function loadMealSuggestions(){
  const account=window.nutritionStore?.getAccountProfileDefaults?.()||{};
  if(savedMealProductsUid===account.uid&&savedMealProducts.length)return savedMealProducts;
  if(savedMealProductsLoading)return savedMealProductsLoading;
  savedMealProductsLoading=window.nutritionStore?.listProducts?.().then(products=>{
    savedMealProducts=Array.isArray(products)?products:[];
    savedMealProductsUid=account.uid;
    renderMealSuggestions(savedMealProducts);
    return savedMealProducts;
  }).catch(()=>[]).finally(()=>{savedMealProductsLoading=null});
  return savedMealProductsLoading||[];
}

function applySavedMealProduct(){
  const title=mealNameInput?.value.trim().toLocaleLowerCase('ru-RU');
  const product=savedMealProducts.find(item=>String(item.title||'').trim().toLocaleLowerCase('ru-RU')===title);
  if(!product)return;
  savedMealEstimate={title,portion:Number(product.portion),calories:Number(product.calories),protein:Number(product.protein),fat:Number(product.fat),carbs:Number(product.carbs)};
  calories.value='';protein.value='';fat.value='';carbs.value='';
  toast('Введите размер порции — БЖУ пересчитаются по данным личной базы');
}

function fillSavedMealNutrition(){
  const amount=Number(portion.value),base=savedMealEstimate;
  if(!base||base.title!==mealNameInput?.value.trim().toLocaleLowerCase('ru-RU')||!Number.isFinite(base.portion)||base.portion<=0||!Number.isFinite(amount)||amount<=0){calories.value='';protein.value='';fat.value='';carbs.value='';return}
  const ratio=amount/base.portion;
  calories.value=Math.round(base.calories*ratio);
  protein.value=Number((base.protein*ratio).toFixed(1));
  fat.value=Number((base.fat*ratio).toFixed(1));
  carbs.value=Number((base.carbs*ratio).toFixed(1));
  setAutomaticPortionUnit();
}

mealNameInput?.addEventListener('focus',loadMealSuggestions);
mealNameInput?.addEventListener('change',applySavedMealProduct);
mealNameInput?.addEventListener('input',()=>{savedMealEstimate=null});
portion.addEventListener('input',fillSavedMealNutrition);
window.addEventListener('nutrition-auth-changed',()=>{savedMealProducts=[];savedMealProductsUid='';savedMealEstimate=null;mealSuggestions.replaceChildren()});

function showAiCalculationResult({title,portionLabel,calories:resultCalories,protein:resultProtein,fat:resultFat,carbs:resultCarbs,error}){
  document.getElementById('aiCalculationResult')?.remove();
  const dialog=document.createElement('div');
  dialog.id='aiCalculationResult';dialog.className='modal show';
  const sheet=document.createElement('section');sheet.className='sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');
  const heading=document.createElement('h2');heading.textContent=error?'Не удалось рассчитать':'Расчёт ИИ';
  const message=document.createElement('p');message.className='hello';
  if(error)message.textContent=error;
  else message.textContent=`${title} · ${portionLabel}`;
  sheet.append(heading,message);
  if(!error){
    const values=document.createElement('p');values.className='hello';
    values.textContent=`${Math.round(resultCalories)} ккал · Б ${Number(resultProtein).toLocaleString('ru-RU',{maximumFractionDigits:1})} г · Ж ${Number(resultFat).toLocaleString('ru-RU',{maximumFractionDigits:1})} г · У ${Number(resultCarbs).toLocaleString('ru-RU',{maximumFractionDigits:1})} г`;
    sheet.append(values);
  }
  const close=document.createElement('button');close.type='button';close.className='primary';close.textContent='Понятно';close.onclick=()=>dialog.remove();sheet.append(close);dialog.append(sheet);document.body.append(dialog);close.focus();
}

// AI can estimate a 100 g base without a user-entered portion. Keep that base
// only in the open form; entering a portion then scales it through the existing
// manual-photo estimate handler.
const calculateNutritionWithOptionalPortion=window.calculateMealNutrition;
window.calculateMealNutrition=async function(clarification=''){
  if(!mealName.value.trim()){mealName.focus();showAiCalculationResult({error:'Введите название блюда'});return}
  const originalPortion=portion.value;
  const hasPortion=Number(originalPortion)>0;
  const calculationPortion=hasPortion?Number(originalPortion):100;
  const unit=hasPortion?document.getElementById('portionUnit').value:'г';
  let calculationError='';
  const originalToast=toast;
  toast=message=>{
    const text=String(message||'');
    if(text.startsWith('Не удалось рассчитать:'))calculationError=text;
    else if(!text.startsWith('Калории и БЖУ заполнены'))originalToast(message);
  };
  savedMealEstimate=null;
  recognizedManualMealEstimate=null;
  calories.value='';protein.value='';fat.value='';carbs.value='';
  if(!hasPortion)portion.value='100';
  try{await calculateNutritionWithOptionalPortion(clarification)}catch(error){calculationError=`Не удалось рассчитать: ${error.message}`}
  finally{toast=originalToast}
  const calculated=calories.value!==''&&Number.isFinite(Number(calories.value));
  if(!calculated){if(!hasPortion)portion.value=originalPortion;showAiCalculationResult({error:calculationError||'ИИ не вернул расчёт'});return}
  const result={title:mealName.value.trim(),portionLabel:`${calculationPortion} ${unit}`,calories:Number(calories.value),protein:Number(protein.value)||0,fat:Number(fat.value)||0,carbs:Number(carbs.value)||0};
  if(!hasPortion){
    recognizedManualMealEstimate={portion:100,calories:result.calories,protein:result.protein,fat:result.fat,carbs:result.carbs};
    portion.value=originalPortion;
    calories.value='';protein.value='';fat.value='';carbs.value='';
    clearMealEstimateError(portion);
  }
  showAiCalculationResult(result);
};
document.getElementById('calculateMealButton').onclick=()=>window.calculateMealNutrition();
