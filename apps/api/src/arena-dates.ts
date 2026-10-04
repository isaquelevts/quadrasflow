const weekdays=['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
const weekdayAliases=[/\bdom(?:ingo)?\b/,/\bseg(?:unda(?:-feira)?)?\b/,/\bter(?:ca)?(?:-feira)?\b/,/\bqua(?:rta(?:-feira)?)?\b/,/\bqui(?:nta(?:-feira)?)?\b/,/\bsex(?:ta(?:-feira)?)?\b/,/\bsab(?:ado)?\b/];
const shift=(day:string,days:number)=>{const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)};
const valid=(day:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const date=new Date(`${day}T12:00:00Z`);return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===day;};
const weekday=(day:string)=>new Date(`${day}T12:00:00Z`).getUTCDay();
export function localNow(timeZone:string,instant=new Date()){
 if(!timeZone)throw new Error('Configure o fuso horário da arena no painel do WhatsApp.');
 let parts:Intl.DateTimeFormatPart[];
 try{parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant)}catch{throw new Error('O fuso horário da arena é inválido. Corrija a configuração.');}
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return {date:`${values.year}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}`};
}
export function displayDate(day:string){const [year,month,date]=day.split('-');return `${weekdays[weekday(day)]}, ${date}/${month}/${year}`;}
export function parseArenaDate(input:string,timeZone:string,instant=new Date()):{date?:string;question?:string}{
 const today=localNow(timeZone,instant).date,raw=input.trim().toLocaleLowerCase('pt-BR'),value=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const nextWeek=/semana que vem|proxima semana/.test(value),weekdayIndex=weekdayAliases.findIndex(pattern=>pattern.test(value)),iso=value.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/),br=value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d))?\b/),monthDay=value.match(/\bdia\s+(\d{1,2})(?:\s+deste\s+mes)?\b/);
 let day='';
 if(iso)day=`${iso[1]}-${iso[2]!.padStart(2,'0')}-${iso[3]!.padStart(2,'0')}`;
 else if(br){day=`${br[3]||today.slice(0,4)}-${br[2]!.padStart(2,'0')}-${br[1]!.padStart(2,'0')}`;if(!br[3]&&day<today)return {question:`Você quis dizer ${day.slice(8)}/${day.slice(5,7)} do próximo ano? Informe a data completa.`};}
 else if(monthDay){day=`${today.slice(0,7)}-${monthDay[1]!.padStart(2,'0')}`;if(day<today)return {question:`O dia ${monthDay[1]} deste mês já passou. Você quis dizer o próximo mês?`};}
 else if(/\bdepois de amanha\b/.test(value))day=shift(today,2);
 else if(/\bamanha\b/.test(value))day=shift(today,1);
 else if(/\bhoje\b/.test(value))day=today;
 else if(weekdayIndex>=0){const current=weekday(today),delta=nextWeek?7-((current+6)%7)+(weekdayIndex+6)%7:((weekdayIndex-current+7)%7||7);day=shift(today,delta);}
 else return {question:'Qual dia você prefere?'};
 if(!valid(day))return {question:'Essa data não existe. Qual outro dia você prefere?'};
 if(nextWeek){const monday=shift(today,-((weekday(today)+6)%7)+7);if(day<monday||day>shift(monday,6))return {question:`“Semana que vem” vai de ${displayDate(monday)} a ${displayDate(shift(monday,6))}, mas a data informada é ${displayDate(day)}. Qual delas vale?`};}
 if(weekdayIndex>=0&&weekday(day)!==weekdayIndex)return {question:`A data informada é ${displayDate(day)}, mas o dia da semana não coincide. Qual data vale?`};
 if(day<today)return {question:'Essa data já passou. Qual data futura você prefere?'};
 if(day>shift(today,90))return {question:'Aceitamos reservas para os próximos 90 dias. Qual data dentro desse período você prefere?'};
 return {date:day};
}

/** Data (AAAA-MM-DD) no fuso informado. Lançamentos usam o dia da arena, não o de UTC (que vira às 21h em Belém). */
export const dayIn=(timeZone:string,instant=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:timeZone||'America/Sao_Paulo'}).format(instant);
