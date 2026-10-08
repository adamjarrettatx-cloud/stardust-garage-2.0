import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInAppBrowser, externalBrowserUrl } from '../lib/in-app-browser.js';
import { isExistingUserError } from '../lib/auth-errors.js';

const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone15,2; iOS 18_5; en_US; en; scale=3.00; 1179x2556)';
const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android';
const FB_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0;FBBV/1]';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

test('detects Instagram on iOS and Android', () => {
  assert.deepEqual(detectInAppBrowser(IG_IOS), { inApp: true, app: 'Instagram', platform: 'ios' });
  assert.deepEqual(detectInAppBrowser(IG_ANDROID), { inApp: true, app: 'Instagram', platform: 'android' });
});

test('detects Facebook in-app browser', () => {
  assert.equal(detectInAppBrowser(FB_IOS).app, 'Facebook');
});

test('real browsers are not flagged', () => {
  assert.equal(detectInAppBrowser(SAFARI).inApp, false);
  assert.equal(detectInAppBrowser(CHROME_ANDROID).inApp, false);
  assert.equal(detectInAppBrowser(DESKTOP).inApp, false);
  assert.equal(detectInAppBrowser('').inApp, false);
});

test('external browser URLs', () => {
  const href = 'https://www.sdgatx.com/events/houseofmirrors?utm_source=ig';
  assert.equal(externalBrowserUrl(href, 'ios'), 'x-safari-https://www.sdgatx.com/events/houseofmirrors?utm_source=ig');
  const a = externalBrowserUrl(href, 'android');
  assert.match(a, /^intent:\/\/www\.sdgatx\.com\/events\/houseofmirrors\?utm_source=ig#Intent;scheme=https;package=com\.android\.chrome;/);
  assert.equal(externalBrowserUrl(href, 'other'), null);
  assert.equal(externalBrowserUrl('javascript:alert(1)', 'ios'), null);
});

test('recognises every Supabase existing-user error shape', () => {
  assert.equal(isExistingUserError({ code: 'email_exists', message: 'A user with this email address has already been registered' }), true);
  assert.equal(isExistingUserError({ code: 'user_already_exists', message: 'User already registered' }), true);
  assert.equal(isExistingUserError({ message: 'A user with this email address has already been registered' }), true);
  assert.equal(isExistingUserError({ code: 'validation_failed', message: 'Unable to validate email address: invalid format' }), false);
  assert.equal(isExistingUserError(null), false);
});
