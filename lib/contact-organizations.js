// Profile identity is independent of booking tags and legal entity type.
// Never turn a known individual into a business because an event tagged them.
export const ORGANIZATION_TAGS = ['organization', 'event_organizer', 'collective'];

export function contactProfileKind(contact) {
  if (['person', 'organization'].includes(contact?.profile_kind)) return contact.profile_kind;
  if (contact?.entity_type === 'individual') return 'person';
  return (contact?.contact_type || []).some((type) => ORGANIZATION_TAGS.includes(type))
    ? 'organization' : 'person';
}

export function validateMainContactRequest(body) {
  if (!body || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    return { error: 'Refresh the organization before changing its main contact.' };
  }
  if (!['contact', 'account', 'create', 'clear'].includes(body.mode)) return { error: 'Choose an existing person or create a new contact.' };
  if (['contact', 'account'].includes(body.mode) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id || '')) {
    return { error: 'Choose a valid profile.' };
  }
  const person = {
    name: String(body.person?.name || '').trim(),
    email: String(body.person?.email || '').trim().toLowerCase(),
    phone: String(body.person?.phone || '').trim(),
  };
  if (body.mode === 'create') {
    if (!person.name || person.name.length > 200) return { error: 'Enter a name of 200 characters or fewer.' };
    if (person.email && (person.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))) return { error: 'Enter a valid email address.' };
    if (person.phone.length > 50) return { error: 'Enter a phone number of 50 characters or fewer.' };
  }
  return { value: { mode: body.mode, id: body.id || null, person, expectedVersion: body.expectedVersion } };
}
