export function parseLeadIntelligence(value: unknown): Record<string,string> {
  const fields: Record<string,string> = Object.create(null);
  const put = (rawKey: unknown, rawValue: unknown) => {
    const key = String(rawKey).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ['constructor','prototype','__proto__'].includes(key)) return;
    if (rawValue !== null && typeof rawValue === 'object') throw new Error('Lead intelligence values must be plain text');
    const text = rawValue == null ? '' : String(rawValue).trim();
    if (Object.prototype.hasOwnProperty.call(fields,key) && fields[key] !== text) throw new Error('Conflicting lead intelligence values for ' + key);
    fields[key] = text;
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key,item] of Object.entries(value)) put(key,item);
    return fields;
  }
  const text = value == null ? '' : String(value).trim();
  if (!text) return fields;
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Lead intelligence must be an object or labeled text');
    for (const [key,item] of Object.entries(parsed)) put(key,item);
    return fields;
  }
  for (const part of text.split(/[|\r\n]+/)) {
    const label = part.trim().match(/^([A-Za-z][A-Za-z0-9_ -]*)\s*[:=]\s*(.*)$/);
    if (label) put(label[1],label[2]);
  }
  return fields;
}

export function buildLeadIntelligence(lead: Record<string,unknown>): string {
  const raw = lead.lead_intelligence == null ? '' : String(lead.lead_intelligence).trim();
  const fields = parseLeadIntelligence(raw);
  if (raw && !Object.keys(fields).length) throw new Error('Lead Intelligence needs labeled fields such as AREA: Austin | SERVICE_NAME: kitchen remodeling.');
  for (const key of ['area','service_name']) {
    const value = lead[key] == null ? '' : String(lead[key]).trim();
    if (!value) continue;
    if (/[|\r\n]/.test(value)) throw new Error('Use one plain value for ' + key + '.');
    if (fields[key] && fields[key] !== value) throw new Error('Conflicting values for ' + key + '. Use the same value in Lead Intelligence and its separate column.');
    fields[key] = value;
  }
  return Object.entries(fields).map(([key,value])=>key.toUpperCase()+': '+value).join(' | ');
}

export function getLeadVariable(lead: Record<string,unknown>,key: string): string {
  const old = parseLeadIntelligence(lead.company_name);
  const fields = Object.assign(Object.create(null),old,parseLeadIntelligence(lead.lead_intelligence));
  return fields[key] || '';
}
