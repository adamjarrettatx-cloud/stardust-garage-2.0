import { INCIDENT_ACTIONS, INCIDENT_CATEGORIES } from './security-labels';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateIncident(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') throw new Error('Invalid incident.');
  if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) throw new Error('Request ID required.');
  if (typeof body.action !== 'string' || !Object.hasOwn(INCIDENT_ACTIONS, body.action)) throw new Error('Choose an action.');
  if (typeof body.category !== 'string' || !Object.hasOwn(INCIDENT_CATEGORIES, body.category)) throw new Error('Choose a category.');
  if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 1500) throw new Error('Enter a factual note of up to 1,500 characters.');
  if (body.identity_confirmed !== true) throw new Error('Confirm guest identity first.');
  if (['ban', 'review'].includes(body.action) && body.restriction_confirmed !== true) throw new Error('Confirm the restriction first.');
}
