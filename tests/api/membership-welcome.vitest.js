import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/app/members/MembershipQuiz', () => ({ default: function Quiz() {} }));
vi.mock('@/app/members/MembershipWelcome', () => ({ default: function Welcome() {} }));
vi.mock('@/app/members/apply/[plan]/ApplicationAccountGate', () => ({ default: function Gate() {} }));
import MembersPage from '@/app/members/page';
import Quiz from '@/app/members/MembershipQuiz';
import Welcome from '@/app/members/MembershipWelcome';
import Gate from '@/app/members/apply/[plan]/ApplicationAccountGate';

beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: mocks.maybeSingle };
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, from: vi.fn(() => query) });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
});
describe('membership welcome entry', () => {
  it('introduces the quiz before querying authentication or saved answers', async () => {
    const view = await MembersPage({ searchParams: Promise.resolve({}) });
    expect(view.type).toBe(Welcome);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('still requires sign-in when Start is clicked', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const view = await MembersPage({ searchParams: Promise.resolve({ start: '1' }) });
    expect(view.type).toBe(Gate);
    expect(view.props.quiz).toBe(true);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });
  it('starts the quiz for a signed-in account without saved results', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-a' } } });
    const view = await MembersPage({ searchParams: Promise.resolve({ start: '1' }) });
    expect(view.type).toBe(Quiz);
    expect(view.props.savedQuiz).toBeNull();
  });
  it('reopens existing saved results through the explicit start URL', async () => {
    const saved = { answers: { age: 29 }, selected_plan: 'cowork-party' };
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-a' } } });
    mocks.maybeSingle.mockResolvedValue({ data: saved, error: null });
    const view = await MembersPage({ searchParams: Promise.resolve({ start: '1' }) });
    expect(view.type).toBe(Quiz);
    expect(view.props.savedQuiz).toEqual(saved);
  });
});
