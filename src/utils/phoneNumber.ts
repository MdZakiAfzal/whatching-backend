export const normalizePhoneNumber = (input: string) => {
  const trimmed = String(input || '').trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  if (!digits) {
    return '';
  }

  return hasLeadingPlus ? `+${digits}` : digits;
};
