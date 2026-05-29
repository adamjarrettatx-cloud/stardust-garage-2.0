'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function MicroPartyInquireForm() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isMember, setIsMember] = useState(null); // null | true | false
  const [websiteOrSocial, setWebsiteOrSocial] = useState('');

  const [eventName, setEventName] = useState('');
  const [eventType, setEventType] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [expectedAttendance, setExpectedAttendance] = useState('');
  const [sellingTickets, setSellingTickets] = useState(null); // null | true | false

  const [eventVision, setEventVision] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [howHeard, setHowHeard] = useState('');

  const [acknowledged, setAcknowledged] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Start time options 7pm - 10pm in 30 min increments
  const startTimeOptions = [
    { value: '19:00', label: '7:00 PM' },
    { value: '19:30', label: '7:30 PM' },
    { value: '20:00', label: '8:00 PM' },
    { value: '20:30', label: '8:30 PM' },
    { value: '21:00', label: '9:00 PM' },
    { value: '21:30', label: '9:30 PM' },
    { value: '22:00', label: '10:00 PM' },
  ];

  const durationOptions = [
    { value: '3', label: '3 hours' },
    { value: '4', label: '4 hours' },
    { value: '5', label: '5 hours' },
    { value: '6', label: '6 hours' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Basic validation
    if (!fullName.trim() || !email.trim()) {
      setError('Please provide your name and email.');
      return;
    }
    if (isMember === null) {
      setError('Please indicate whether you are a member.');
      return;
    }
    if (!acknowledged) {
      setError('Please acknowledge the terms by checking the box at the bottom.');
      return;
    }

    setSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from('micro_party_inquiries')
      .insert({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        is_member: isMember,
        website_or_social: websiteOrSocial.trim() || null,

        event_name: eventName.trim() || null,
        event_type: eventType.trim() || null,
        event_date: eventDate || null,
        start_time: startTime || null,
        duration_hours: durationHours ? parseInt(durationHours, 10) : null,
        expected_attendance: expectedAttendance ? parseInt(expectedAttendance, 10) : null,
        selling_tickets: sellingTickets,

        event_vision: eventVision.trim() || null,
        special_requests: specialRequests.trim() || null,
        how_heard: howHeard.trim() || null,

        acknowledged_terms: acknowledged,
      });

    if (insertError) {
      setError('Something went wrong: ' + insertError.message);
      setSubmitting(false);
      return;
    }

    // Fire-and-forget email notifications
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'micro_party_inquiry',
        data: {
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          is_member: isMember,
          website_or_social: websiteOrSocial.trim() || null,
          event_name: eventName.trim() || null,
          event_type: eventType.trim() || null,
          event_date: eventDate || null,
          start_time: startTime || null,
          duration_hours: durationHours || null,
          expected_attendance: expectedAttendance || null,
          selling_tickets: sellingTickets,
          event_vision: eventVision.trim() || null,
          special_requests: specialRequests.trim() || null,
          how_heard: howHeard.trim() || null,
        },
        email: email.trim(),
      }),
    }).catch(() => {});

    setSuccess(true);
    setSubmitting(false);
  };

  if (success) {
    return (
      <main className="max-w-[700px] mx-auto px-4 md:px-6 py-20 md:py-24 text-center">
        <div
          className="text-[11px] font-semibold tracking-[0.2em] mb-5"
          style={{ color: '#8a8a8a' }}
        >
          INQUIRY RECEIVED
        </div>
        <h1
          className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] mb-6 leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Thank you.
        </h1>
        <p className="text-[15px] leading-[1.6] mb-10" style={{ color: '#a0a0a0' }}>
          We&apos;ll review your event details and reach out within 48 hours to discuss next steps.
        </p>
        <button
          type="button"
          onClick={() => router.push('/venue-rental')}
          className="px-8 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          BACK TO VENUE RENTAL
        </button>
      </main>
    );
  }

  const inputStyle = {
    background: '#141414',
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#f5f5f5',
  };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: '#8a8a8a' };

  return (
    <main className="max-w-[780px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <h1
        className="text-[36px] md:text-[52px] font-extrabold -tracking-[0.02em] mb-3 leading-[1.1]"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Micro Parties
      </h1>
      <p className="text-[15px] leading-[1.55] mb-10 md:mb-12" style={{ color: '#8a8a8a' }}>
        Tell us about your event and we&apos;ll be in touch within 48 hours.
      </p>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* CONTACT INFO */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2
            className="text-[18px] font-bold mb-6"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Contact Info
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>FULL NAME *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={labelStyle}>EMAIL *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>PHONE</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU A MEMBER? *</label>
              <div className="flex gap-3">
                {[
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ].map((opt) => {
                  const active = isMember === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setIsMember(opt.value)}
                      className="px-7 py-2.5 rounded-full text-[13px] font-semibold tracking-[0.08em] transition-all border"
                      style={{
                        background: active ? '#ffffff' : 'transparent',
                        color: active ? '#0a0a0a' : '#f5f5f5',
                        borderColor: active ? '#ffffff' : 'rgba(255,255,255,0.2)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>WEBSITE / SOCIAL LINK</label>
              <input
                type="text"
                value={websiteOrSocial}
                onChange={(e) => setWebsiteOrSocial(e.target.value)}
                placeholder="instagram.com/yourname or yourwebsite.com"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* EVENT DETAILS */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2
            className="text-[18px] font-bold mb-6"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Event Details
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>EVENT NAME / TITLE</label>
              <input
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Sarah's 30th Birthday"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>EVENT TYPE</label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g. Birthday party, anniversary, going-away..."
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>REQUESTED DATE</label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass} style={labelStyle}>START TIME</label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="" style={{ background: '#141414' }}>Choose a start time</option>
                  {startTimeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} style={{ background: '#141414' }}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>DURATION (3HR MIN)</label>
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="" style={{ background: '#141414' }}>Choose a duration</option>
                  {durationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} style={{ background: '#141414' }}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-[12px] -mt-2" style={{ color: '#666' }}>
              Available between 7:00 PM and 1:00 AM. Minimum 3 hours.
            </p>

            <div>
              <label className={labelClass} style={labelStyle}>EXPECTED ATTENDANCE</label>
              <input
                type="number"
                min="1"
                max="44"
                value={expectedAttendance}
                onChange={(e) => setExpectedAttendance(e.target.value)}
                placeholder="Up to 44 people"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU SELLING TICKETS?</label>
              <div className="flex gap-3">
                {[
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ].map((opt) => {
                  const active = sellingTickets === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setSellingTickets(opt.value)}
                      className="px-7 py-2.5 rounded-full text-[13px] font-semibold tracking-[0.08em] transition-all border"
                      style={{
                        background: active ? '#ffffff' : 'transparent',
                        color: active ? '#0a0a0a' : '#f5f5f5',
                        borderColor: active ? '#ffffff' : 'rgba(255,255,255,0.2)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* VISION & ADDITIONAL INFO */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2
            className="text-[18px] font-bold mb-6"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Vision &amp; Additional Info
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>DESCRIBE YOUR VISION FOR THE EVENT</label>
              <textarea
                value={eventVision}
                onChange={(e) => setEventVision(e.target.value)}
                rows={4}
                className={inputClass}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '110px' }}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ANY SPECIAL REQUESTS OR NOTES?</label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                rows={3}
                className={inputClass}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '90px' }}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>HOW DID YOU HEAR ABOUT STARDUST GARAGE?</label>
              <input
                type="text"
                value={howHeard}
                onChange={(e) => setHowHeard(e.target.value)}
                placeholder="e.g. Instagram, friend referral, attended an event..."
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* TERMS ACKNOWLEDGEMENT */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 w-4 h-4 cursor-pointer"
            style={{ accentColor: '#f5f5f5' }}
          />
          <span className="text-[13px] leading-[1.55]" style={{ color: '#a0a0a0' }}>
            By checking this box, I understand that submitting this inquiry does not guarantee event approval or booking. The Stardust Garage team will review my request and follow up within 48 hours to discuss availability and next steps.
          </span>
        </label>

        {error && (
          <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {submitting ? 'SUBMITTING...' : 'SUBMIT INQUIRY'}
        </button>
      </form>
    </main>
  );
}
