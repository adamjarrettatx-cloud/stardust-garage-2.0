// ---------------------------------------------------------------------------
// Admin sidebar counts
// ---------------------------------------------------------------------------
// Extracted from app/bananas/layout.js so the /team layout can render the same
// sidebar with the same badge numbers. Two copies of these ten queries would
// have drifted the moment a tile gained or lost a count.
//
// Every count is defensive: a missing table or a failed query yields 0 rather
// than throwing, because a broken badge must never take down the page it sits
// beside.
import { getTodayInAustin } from '@/lib/studio-helpers';
import { totalUnreadCount } from '@/lib/chat';

export async function fetchAdminCounts(supabase) {
  const today = getTodayInAustin();

  const [
    applicationsCount,
    venueInquiriesCount,
    microPartiesCount,
    collaborationsCount,
    newSignupsCount,
    upcomingBookingsCount,
    activeMembersCount,
    pastDueMembersCount,
    unreadChat,
    pendingPayRequestsCount,
  ] = await Promise.all([
    supabase.from('membership_applications').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('venue_inquiries').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('micro_party_inquiries').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('collaborations').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('signups').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('studio_bookings').select('*', { count: 'exact', head: true }).eq('status', 'confirmed').gte('booking_date', today),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'past_due'),
    // Unread Team Chat messages for whoever is signed in. Scoped to the caller
    // by the RPC itself — it takes no arguments.
    supabase.rpc('chat_unread_counts'),
    // artist_pay_requests doesn't exist on live Supabase until the Phase 3
    // migration is applied — this errors harmlessly until then (count comes
    // back undefined, || 0 below covers it).
    supabase.from('artist_pay_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
  ]);

  return {
    applications: applicationsCount?.count || 0,
    venueInquiries: venueInquiriesCount?.count || 0,
    microParties: microPartiesCount?.count || 0,
    collaborations: collaborationsCount?.count || 0,
    newSignups: newSignupsCount?.count || 0,
    upcomingBookings: upcomingBookingsCount?.count || 0,
    activeMembers: activeMembersCount?.count || 0,
    pastDueMembers: pastDueMembersCount?.count || 0,
    unreadChat: totalUnreadCount(unreadChat?.data),
    pendingPayRequests: pendingPayRequestsCount?.count || 0,
  };
}
