// Isolated UI fixture, never a production authentication path.
import React from 'react';
import { createRoot } from 'react-dom/client';
import MembershipQuiz from '../../app/members/MembershipQuiz';
import content from '../../lib/customer-content.json';
const account = new URLSearchParams(location.search).get('account') || 'qa-account-a';
const nativeFetch = window.fetch.bind(window);
window.fetch = (url, options = {}) => nativeFetch(url, { ...options, headers: { ...options.headers, 'x-qa-account': account } });
fetch('/__qa/result').then(r => r.json()).then(savedQuiz => {
  createRoot(document.getElementById('root')).render(<MembershipQuiz plans={content.membership.plans} savedQuiz={savedQuiz} />);
});
