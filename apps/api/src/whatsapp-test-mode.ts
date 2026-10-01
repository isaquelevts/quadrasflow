// Modo de teste do WhatsApp (sem banco, para poder testar isolado).
// O número cadastrado e o que o WhatsApp entrega podem diferir só pelo 9º dígito dos celulares brasileiros
// (5594981234142 × 559481234142); os dois valem como a mesma pessoa.

const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function testPhoneMatches(received: string, authorized: string) {
  const incoming = onlyDigits(received), allowed = onlyDigits(authorized);
  if (incoming === allowed) return true;
  if (!incoming.startsWith('55') || !allowed.startsWith('55') || ![12, 13].includes(incoming.length) || ![12, 13].includes(allowed.length) || incoming.length === allowed.length || incoming.slice(2, 4) !== allowed.slice(2, 4)) return false;
  const incomingNational = incoming.slice(4), allowedNational = allowed.slice(4);
  return (incomingNational.length === 9 && incomingNational.startsWith('9') && incomingNational.slice(1) === allowedNational) || (allowedNational.length === 9 && allowedNational.startsWith('9') && allowedNational.slice(1) === incomingNational);
}

/** O contato está na lista de números de teste (comparação flexível). */
export const isTestPhone = (phone: string, testPhones: readonly string[] | undefined) => (testPhones ?? []).some((allowed) => testPhoneMatches(phone, allowed));
