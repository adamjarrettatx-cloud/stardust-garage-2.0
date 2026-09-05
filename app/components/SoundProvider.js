'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Global background-sound context.
 *
 * - Default state on very first visit: ON (soundOn = true), so the site's
 *   background track fires up as soon as the browser lets us play it.
 * - Once the user makes an explicit choice (toggles the button on any page),
 *   we persist that choice in localStorage and honor it on every subsequent
 *   page + visit until they toggle again.
 * - One <audio> element lives at the root of the app and keeps playing across
 *   client-side route changes, so navigating from the splash into the site
 *   doesn't restart or interrupt the track.
 *
 * Browser autoplay policies: most browsers block audible autoplay until the
 * user has interacted with the page. We still *try* to auto-play on load
 * when soundOn is true (some environments allow it — e.g. returning visitors
 * with a media engagement score, or after any prior interaction). If the
 * browser blocks it, we keep soundOn = true in state and start playback on
 * the first user gesture (click / keydown / touchstart) anywhere on the page.
 * The visible "SOUND ON / OFF" label always reflects the user's intent, not
 * the browser's autoplay verdict.
 */

const AUDIO_SRC =
  'https://iwgfelvbebqbaotkylsw.supabase.co/storage/v1/object/public/site-assets/sdg-bg-track.mp3';

const STORAGE_KEY = 'sdg:soundOn';

const SoundContext = createContext({
  soundOn: true,
  toggleSound: () => {},
  ready: false,
});

export function useSound() {
  return useContext(SoundContext);
}

export default function SoundProvider({ children }) {
  // Default to ON. We flip this from localStorage once mounted if the user
  // previously chose OFF. We keep the SSR default as `true` so the initial
  // markup matches the "start with sound on" intent.
  const [soundOn, setSoundOn] = useState(true);
  const [ready, setReady] = useState(false);
  const audioRef = useRef(null);
  const userHasChosenRef = useRef(false);

  // Load persisted preference on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'false') {
        setSoundOn(false);
        userHasChosenRef.current = true;
      } else if (stored === 'true') {
        setSoundOn(true);
        userHasChosenRef.current = true;
      }
      // If nothing stored → first visit → keep default true.
    } catch {
      // localStorage unavailable — fall through with default.
    }
    setReady(true);
  }, []);

  // Sync <audio> element with soundOn state.
  useEffect(() => {
    if (!ready) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (soundOn) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Autoplay blocked. Leave soundOn = true in state (that's still the
          // user's intent) and wait for a user gesture. The gesture listener
          // below will retry play() then.
        });
      }
    } else {
      audio.pause();
    }
  }, [soundOn, ready]);

  // If autoplay was blocked but the user's intent is soundOn === true,
  // retry play() on the first user gesture anywhere on the page.
  useEffect(() => {
    if (!ready) return;
    if (!soundOn) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) return; // already playing

    const tryPlay = () => {
      const audioEl = audioRef.current;
      if (!audioEl) return;
      const p = audioEl.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          removeListeners();
        }).catch(() => {
          // Still blocked — leave listeners in place for the next gesture.
        });
      } else {
        removeListeners();
      }
    };

    const removeListeners = () => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
      window.removeEventListener('touchstart', tryPlay);
    };

    window.addEventListener('pointerdown', tryPlay, { once: false });
    window.addEventListener('keydown', tryPlay, { once: false });
    window.addEventListener('touchstart', tryPlay, { once: false });

    return removeListeners;
  }, [soundOn, ready]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      userHasChosenRef.current = true;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <SoundContext.Provider value={{ soundOn, toggleSound, ready }}>
      {/*
        Single persistent audio element. Rendered at the root so it survives
        client-side route changes. `loop` for continuous background play.
      */}
      <audio
        ref={audioRef}
        loop
        preload="auto"
        src={AUDIO_SRC}
        aria-hidden="true"
      />
      {children}
    </SoundContext.Provider>
  );
}
